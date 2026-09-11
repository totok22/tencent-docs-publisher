import { parseRemoteMdx, remoteContentFingerprint } from "../convert/remote-mdx-parser";
import { validateGeneratedMdx } from "../convert/markdown-to-mdx";
import { PublisherError } from "../tencent/errors";
import { readCompletePage, type ToolJsonCaller } from "../tencent/smartcanvas";
import type { PagePreflight } from "./preflight";
import type { PublishProject } from "../types";

export interface PublishPageResult {
	pageId: string;
	remoteHash: string;
	deletedBlocks: number;
	preservedBlocks: number;
}

/**
 * smartcanvas.edit 没有页面参数：正文只会落进“锚点 Block 所属的页面”。
 *
 * 实测（2026-09-11）：
 * - 用子页面内部的普通块当锚点，INSERT_BEFORE 会准确写进该子页面；
 * - 用 <Page> 块当锚点会被拒绝（cannot insert content at page block）；
 * - 传 page_id 会被忽略，不带锚点的 INSERT_AFTER 追加到文档末尾，也就是根页面。
 *
 * 因此子页面必须有自己的普通块才能写入；否则返回需要用户先补一个占位段落的说明。
 */
export function describeUnwritablePage(project: PublishProject, preflight: PagePreflight): string | null {
	const binding = project.pageMap[preflight.localPath];
	if (!binding || !preflight.parsedRemote) return null;
	if (binding.pageId === project.remoteRootPageId) return null;
	if (!preflight.conversion.mdx.trim()) return null;
	const hasOwnBlock = preflight.parsedRemote.blocks.some((block) => block.id && !block.preserve);
	if (hasOwnBlock) return null;
	return `子页面“${binding.remoteTitle || binding.localTitle}”在腾讯文档里还没有正文，接口找不到可以定位的插入点。请先在该子页面里输入任意一个字符作为占位，发布后插件会自动删掉它。`;
}

export async function publishPreparedPage(
	client: ToolJsonCaller,
	project: PublishProject,
	preflight: PagePreflight,
	generatedMdx: string,
	allowConflict = false,
): Promise<PublishPageResult> {
	const binding = project.pageMap[preflight.localPath];
	if (!binding) throw new Error("页面尚未绑定。");
	if (!preflight.remoteFresh || !preflight.remoteContent || !preflight.parsedRemote) {
		throw new Error("正式发布前必须执行刷新后预检。");
	}
	if (preflight.status === "conflict" && !allowConflict) throw new Error("检测到远端人工修改，已阻止覆盖。");
	if (preflight.status === "error" || preflight.errors.length) throw new Error(preflight.errors.join("\n"));
	const mdxErrors = validateGeneratedMdx(generatedMdx);
	if (mdxErrors.length) throw new Error(mdxErrors.join("\n"));

	const before = preflight.parsedRemote;
	const writable = before.blocks.filter((block) => !block.preserve);
	if (writable.some((block) => !block.id)) throw new Error("远端普通内容块缺少 Block ID，无法安全替换。");
	const unwritable = describeUnwritablePage(project, preflight);
	if (unwritable) throw new PublisherError(unwritable, "EMPTY_SUB_PAGE", "insert-page-content");
	const anchor = writable.find((block) => block.id)?.id ?? null;
	const expectedChildIds = before.directChildPages.map((page) => page.pageId);
	let mutated = false;
	let remoteHash: string;
	try {
		if (generatedMdx.trim()) {
			try {
				await edit(
					client,
					project.remoteFileId,
					anchor ? "INSERT_BEFORE" : "INSERT_AFTER",
					anchor ?? undefined,
					generatedMdx,
					"insert-page-content",
				);
				mutated = true;
			} catch (error) {
				const probe = await readCompletePage(client, project.remoteFileId, binding.pageId);
				const probeHash = await remoteContentFingerprint(probe.content, binding.pageId);
				if (probeHash === preflight.remoteHash) throw error;
				mutated = true;
			}
		}
		for (const block of writable) {
			try {
				await edit(client, project.remoteFileId, "DELETE", block.id!, undefined, "delete-old-block");
				mutated = true;
			} catch (error) {
				const probe = await readCompletePage(client, project.remoteFileId, binding.pageId);
				if (parseRemoteMdx(probe.content, binding.pageId).blocks.some((candidate) => candidate.id === block.id)) throw error;
			}
		}

		const afterRead = await readCompletePage(client, project.remoteFileId, binding.pageId);
		const after = parseRemoteMdx(afterRead.content, binding.pageId);
		const actualChildIds = after.directChildPages.map((page) => page.pageId);
		if (actualChildIds.length !== expectedChildIds.length || actualChildIds.some((id, index) => id !== expectedChildIds[index])) {
			throw new PublisherError("发布后子页面结构校验失败。", "AMBIGUOUS_WRITE", "verify-page");
		}
		remoteHash = await remoteContentFingerprint(afterRead.content, binding.pageId);
	} catch (error) {
		if (mutated) {
			const restored = await restoreSnapshot(
				client,
				project.remoteFileId,
				binding.pageId,
				preflight.remoteContent,
				preflight.remoteHash,
			);
			if (!restored) {
				throw new PublisherError("发布失败且无法确认快照恢复结果，请打开远端页面检查。", "AMBIGUOUS_WRITE", "restore-page");
			}
		}
		throw error;
	}
	binding.lastPublishedSourceHash = preflight.sourceHash;
	binding.lastPublishedRemoteHash = remoteHash;
	binding.lastPublishedAt = new Date().toISOString();
	return {
		pageId: binding.pageId,
		remoteHash,
		deletedBlocks: writable.length,
		preservedBlocks: before.blocks.length - writable.length,
	};
}

async function restoreSnapshot(
	client: ToolJsonCaller,
	fileId: string,
	pageId: string,
	snapshotContent: string,
	snapshotHash: string | null,
): Promise<boolean> {
	try {
		const currentRead = await readCompletePage(client, fileId, pageId);
		const current = parseRemoteMdx(currentRead.content, pageId);
		const currentWritable = current.blocks.filter((block) => !block.preserve && block.id);
		const snapshot = parseRemoteMdx(snapshotContent, pageId);
		const oldOrdinaryContent = snapshot.blocks.filter((block) => !block.preserve).map((block) => block.raw).join("\n");
		if (oldOrdinaryContent) {
			const anchor = currentWritable.find((block) => block.id)?.id;
			await edit(
				client,
				fileId,
				anchor ? "INSERT_BEFORE" : "INSERT_AFTER",
				anchor ?? undefined,
				oldOrdinaryContent,
				"restore-insert",
			);
		}
		for (const block of currentWritable) {
			try {
				await edit(client, fileId, "DELETE", block.id!, undefined, "restore-delete");
			} catch {
				const probe = await readCompletePage(client, fileId, pageId);
				if (parseRemoteMdx(probe.content, pageId).blocks.some((candidate) => candidate.id === block.id)) return false;
			}
		}
		const restored = await readCompletePage(client, fileId, pageId);
		const expectedHash = snapshotHash ?? await remoteContentFingerprint(snapshotContent, pageId);
		return await remoteContentFingerprint(restored.content, pageId) === expectedHash;
	} catch {
		return false;
	}
}

async function edit(
	client: ToolJsonCaller,
	fileId: string,
	action: "INSERT_BEFORE" | "INSERT_AFTER" | "DELETE",
	id: string | undefined,
	content: string | undefined,
	stage: string,
): Promise<void> {
	await client.callToolJson("smartcanvas.edit", {
		file_id: fileId,
		action,
		...(id !== undefined ? { id } : {}),
		...(content !== undefined ? { content } : {}),
	}, stage);
}

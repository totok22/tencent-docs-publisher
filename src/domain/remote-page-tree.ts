import { parseRemoteMdx, remoteContentFingerprint } from "../convert/remote-mdx-parser";
import { readCompletePage, type ToolJsonCaller } from "../tencent/smartcanvas";
import type { RemotePageNode } from "../types";

export interface RemoteTreeResult {
	rootPageId: string;
	nodes: Record<string, RemotePageNode>;
	/** Fresh page snapshots used by the same operation; never persisted in plugin data. */
	contents: Record<string, string>;
	warnings: string[];
}

export async function discoverRemotePageTree(
	client: ToolJsonCaller,
	fileId: string,
	rootPageId: string,
	rootTitle: string,
	maxDepth = 32,
): Promise<RemoteTreeResult> {
	const nodes: Record<string, RemotePageNode> = {};
	const contents: Record<string, string> = {};
	const warnings: string[] = [];
	const seen = new Set<string>();

	async function visit(pageId: string, title: string, parentPageId: string | null, depth: number): Promise<void> {
		if (seen.has(pageId)) {
			warnings.push(`远端 Page ID 重复：${pageId}`);
			return;
		}
		seen.add(pageId);
		if (depth > maxDepth) {
			warnings.push(`远端页面树超过最大深度 ${maxDepth}：${title}`);
			return;
		}
		const read = await readCompletePage(client, fileId, pageId);
		contents[pageId] = read.content;
		const parsed = parseRemoteMdx(read.content, pageId);
		const children = parsed.directChildPages;
		nodes[pageId] = {
			pageId,
			parentPageId,
			title,
			childPageIds: children.map((child) => child.pageId),
			contentFingerprint: await remoteContentFingerprint(read.content, pageId),
		};
		for (const child of children) await visit(child.pageId, child.title, pageId, depth + 1);
	}

	await visit(rootPageId, rootTitle, null, 0);
	return { rootPageId, nodes, contents, warnings };
}

export async function resolveRemoteDocumentRoot(
	client: ToolJsonCaller,
	fileId: string,
): Promise<{ pageId: string; title: string; remoteUrl: string }> {
	const [topPayload, infoPayload] = await Promise.all([
		client.callToolJson<unknown>("smartcanvas.get_top_level_pages", { file_id: fileId }, "get-root-page"),
		client.callToolJson<unknown>("manage.query_file_info", { file_id: fileId }, "query-file-info"),
	]);
	const topContainers = payloadContainers(topPayload);
	const info = payloadContainers(infoPayload).find((record) => stringField(record, ["type", "title", "name"])) ?? {};
	const firstPage = firstTopLevelPage(topPayload, topContainers);
	const root = topContainers.map((record) => asRecord(record.root)).find((record) => record !== null);
	const type = stringField(info, ["type", "file_type", "fileType"]);
	if (type && type !== "smartcanvas") throw new Error(`目标文件类型为 ${type}，不是腾讯智能文档。`);
	const pageId = firstStringFrom(topContainers, ["root_page_id", "rootPageId", "page_id", "pageId"])
		?? stringField(root ?? {}, ["page_id", "pageId", "id"])
		?? stringField(firstPage ?? {}, ["page_id", "pageId", "id"]);
	if (!pageId) throw new Error("腾讯接口未返回智能文档根 Page ID。");
	return {
		pageId,
		title: stringField(info, ["title", "name", "file_name", "fileName"])
			?? pageTitle(firstPage)
			?? "未命名文档",
		remoteUrl: stringField(info, ["file_url", "fileUrl", "url"]) ?? "",
	};
}

function payloadContainers(payload: unknown): Record<string, unknown>[] {
	const root = asRecord(payload);
	if (!root) return [];
	const containers = [root];
	for (const key of ["data", "result", "payload"]) {
		const nested = asRecord(root[key]);
		if (nested) containers.push(nested);
	}
	return containers;
}

function firstTopLevelPage(
	payload: unknown,
	containers: Record<string, unknown>[],
): Record<string, unknown> | null {
	const collections: unknown[] = Array.isArray(payload) ? [payload] : [];
	for (const container of containers) {
		for (const key of ["pages", "top_level_pages", "topLevelPages", "list"]) {
			if (Array.isArray(container[key])) collections.push(container[key]);
		}
	}
	for (const collection of collections) {
		if (!Array.isArray(collection)) continue;
		const page = collection.map(asRecord).find((record) =>
			record !== null && Boolean(stringField(record, ["page_id", "pageId", "id"])),
		);
		if (page) return page;
	}
	return null;
}

function pageTitle(page: Record<string, unknown> | null): string | undefined {
	if (!page) return undefined;
	const direct = stringField(page, ["title", "name"]);
	if (direct) return direct;
	let element = asRecord(page.element);
	if (!element && typeof page.element === "string") {
		try {
			element = asRecord(JSON.parse(page.element) as unknown);
		} catch {
			const deployedTitle = page.element.match(/(?:^|[,{])\s*title\s*:\s*(?:"([^"]*)"|'([^']*)')/)?.slice(1).find(Boolean);
			if (deployedTitle) return deployedTitle;
		}
	}
	return stringField(element ?? {}, ["title", "name"]);
}

function firstStringFrom(records: Record<string, unknown>[], keys: string[]): string | undefined {
	for (const record of records) {
		const value = stringField(record, keys);
		if (value) return value;
	}
	return undefined;
}

function stringField(record: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value) return value;
	}
	return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

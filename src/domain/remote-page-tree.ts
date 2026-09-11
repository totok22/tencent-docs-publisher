import { parseRemoteMdx, remoteContentFingerprint } from "../convert/remote-mdx-parser";
import { readCompletePage, type ToolJsonCaller } from "../tencent/smartcanvas";
import type { RemotePageNode } from "../types";

export interface RemoteTreeResult {
	rootPageId: string;
	nodes: Record<string, RemotePageNode>;
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
	return { rootPageId, nodes, warnings };
}

interface TopLevelPagesResponse {
	root_page_id?: string;
	page_id?: string;
	root?: { page_id?: string; id?: string };
	pages?: Array<{ page_id?: string; id?: string; title?: string }>;
}

interface FileInfoResponse {
	title?: string;
	name?: string;
	file_url?: string;
	url?: string;
	type?: string;
}

export async function resolveRemoteDocumentRoot(
	client: ToolJsonCaller,
	fileId: string,
): Promise<{ pageId: string; title: string; remoteUrl: string }> {
	const [top, info] = await Promise.all([
		client.callToolJson<TopLevelPagesResponse>("smartcanvas.get_top_level_pages", { file_id: fileId }, "get-root-page"),
		client.callToolJson<FileInfoResponse>("manage.query_file_info", { file_id: fileId }, "query-file-info"),
	]);
	const firstPage = top.pages?.find((page) => page.page_id || page.id);
	if (info.type && info.type !== "smartcanvas") throw new Error(`目标文件类型为 ${info.type}，不是腾讯智能文档。`);
	const pageId = top.root_page_id ?? top.page_id ?? top.root?.page_id ?? top.root?.id ?? firstPage?.page_id ?? firstPage?.id;
	if (!pageId) throw new Error("腾讯接口未返回智能文档根 Page ID。");
	return { pageId, title: info.title ?? info.name ?? firstPage?.title ?? "未命名文档", remoteUrl: info.file_url ?? info.url ?? "" };
}

import { applyResolvedAssets, validateGeneratedMdx } from "../convert/markdown-to-mdx";
import type { LocalPageRepository, LocalTreeResult } from "../domain/local-page-tree";
import { requestPublicRead, type PermissionRequestResult } from "../tencent/permissions";
import { PublishAssetResolver } from "../tencent/assets";
import type { ToolJsonCaller } from "../tencent/smartcanvas";
import type { PublishProject, TencentDocsPublisherData } from "../types";
import { preflightPage, type PagePreflight, type PreflightVaultReader } from "./preflight";
import { publishPreparedPage } from "./publish-page";
import { refreshBindings } from "./refresh-bindings";

export interface RequestBudget {
	pageReadsAtLeast: number;
	pageWritesAtLeast: number;
	uniqueImages: number;
	changedPdfs: number;
}

export interface ProjectPreflight {
	project: PublishProject;
	localTree: LocalTreeResult;
	pages: PagePreflight[];
	budget: RequestBudget;
	blockers: string[];
}

export interface PublishProgress {
	stage: "prepare" | "assets" | "pages" | "permissions" | "verify";
	completed: number;
	total: number;
	pagePath?: string;
}

export interface ProjectPublishResult {
	published: string[];
	skipped: string[];
	permissions: PermissionRequestResult[];
	cancelled: boolean;
}

const activeDocuments = new Set<string>();

export async function prepareProjectPreflight(
	project: PublishProject,
	repository: LocalPageRepository,
	reader: PreflightVaultReader,
	client: ToolJsonCaller,
	data: TencentDocsPublisherData,
): Promise<ProjectPreflight> {
	const embeddedMarkdownAsPage = project.embeddedMarkdownAsPage ?? data.defaults.embeddedMarkdownAsPage;
	const refreshed = await refreshBindings(project, repository, client, embeddedMarkdownAsPage);
	const localTree = refreshed.localTree;
	data.remoteTreeCaches[project.id] = refreshed.cache;
	if (refreshed.remoteUrl) project.remoteUrl = refreshed.remoteUrl;
	const nodes = flatten(localTree.root);
	const pages: PagePreflight[] = [];
	for (const node of nodes) {
		pages.push(await preflightPage(reader, project, node.path, "refreshed", client, data.remoteTreeCaches[project.id], embeddedMarkdownAsPage));
	}
	const blockers = pages
		.filter((page) => ["error", "unbound", "conflict"].includes(page.status))
		.map((page) => `${page.localPath}：${page.status === "conflict" ? "远端内容冲突" : page.errors.join("；") || "页面未绑定"}`);
	blockers.push(...refreshed.proposals.filter((proposal) => proposal.status === "hierarchy-changed").map((proposal) => `${proposal.localPath}：远端层级已变更，需要重新确认绑定`));
	blockers.push(...localTree.diagnostics.filter((diagnostic) => diagnostic.kind === "max-depth" || diagnostic.kind === "max-notes").map((diagnostic) => `${diagnostic.parentPath}：${diagnostic.message}`));
	const changed = pages.filter((page) => page.status === "changed" || (!data.defaults.skipUnchanged && page.status === "unchanged"));
	const uniqueImages = new Set(changed.flatMap((page) => page.assets.filter((asset) => asset.kind === "image").map((asset) => asset.contentHash))).size;
	const changedPdfs = changed.flatMap((page) => page.assets.filter((asset) => asset.kind === "pdf")).filter((asset) => {
		const cached = asset.resolvedPath ? data.importedPdfs[asset.resolvedPath] : undefined;
		return !cached || cached.contentHash !== asset.contentHash;
	}).length;
	return {
		project,
		localTree,
		pages,
		blockers,
		budget: {
			pageReadsAtLeast: pages.length * 2,
			pageWritesAtLeast: changed.length,
			uniqueImages,
			changedPdfs,
		},
	};
}

export async function executeProjectPublish(
	preflight: ProjectPreflight,
	reader: PreflightVaultReader,
	client: ToolJsonCaller,
	data: TencentDocsPublisherData,
	upload: (url: string, body: ArrayBuffer) => Promise<void>,
	options: {
		signal?: AbortSignal;
		onProgress?: (progress: PublishProgress) => void;
		saveState?: () => Promise<void>;
		allowConflicts?: Set<string>;
	} = {},
): Promise<ProjectPublishResult> {
	const { project } = preflight;
	if (activeDocuments.has(project.remoteFileId)) throw new Error("同一腾讯文档已有发布任务正在运行。");
	const unresolvedBlockers = preflight.blockers.filter((blocker) => {
		const path = blocker.split("：")[0] ?? "";
		return !options.allowConflicts?.has(path) || !blocker.includes("远端内容冲突");
	});
	if (unresolvedBlockers.length) throw new Error(unresolvedBlockers.join("\n"));
	activeDocuments.add(project.remoteFileId);
	const published: string[] = [];
	let skipped: string[] = [];
	let permissions: PermissionRequestResult[] = [];
	try {
		const changed = preflight.pages.filter((page) =>
			page.status === "changed" ||
			(!data.defaults.skipUnchanged && page.status === "unchanged") ||
			options.allowConflicts?.has(page.localPath),
		);
		const resolver = new PublishAssetResolver(client, reader, data.importedPdfs, upload);
		const rendered = new Map<string, { page: PagePreflight; mdx: string; pdfIds: string[] }>();
		options.onProgress?.({ stage: "assets", completed: 0, total: changed.length });
		for (let index = 0; index < changed.length; index += 1) {
			throwIfCancelled(options.signal);
			const page = changed[index]!;
			const assets = await resolver.resolve(page.assets, options.signal);
			const mdx = applyResolvedAssets(page.conversion, assets.urls);
			const errors = validateGeneratedMdx(mdx);
			if (errors.length) throw new Error(`${page.localPath}：${errors.join("；")}`);
			rendered.set(page.localPath, { page, mdx, pdfIds: assets.referencedPdfFileIds });
			options.onProgress?.({ stage: "assets", completed: index + 1, total: changed.length, pagePath: page.localPath });
		}

		const order = flatten(preflight.localTree.root)
			.map((node, index) => ({ node, index }))
			.sort((a, b) => b.node.depth - a.node.depth || a.index - b.index)
			.map(({ node }) => node.path)
			.filter((path) => rendered.has(path));
		const pdfIds = new Set<string>();
		for (let index = 0; index < order.length; index += 1) {
			throwIfCancelled(options.signal);
			const item = rendered.get(order[index]!);
			if (!item) continue;
			options.onProgress?.({ stage: "pages", completed: index, total: order.length, pagePath: item.page.localPath });
			await publishPreparedPage(client, project, item.page, item.mdx, options.allowConflicts?.has(item.page.localPath));
			published.push(item.page.localPath);
			for (const id of item.pdfIds) pdfIds.add(id);
			await options.saveState?.();
			options.onProgress?.({ stage: "verify", completed: index + 1, total: order.length, pagePath: item.page.localPath });
		}
		if (project.publicRead) {
			options.onProgress?.({ stage: "permissions", completed: 0, total: pdfIds.size + 1 });
			permissions = await requestPublicRead(client, [project.remoteFileId, ...pdfIds]);
		}
		await options.saveState?.();
		skipped = preflight.pages.filter((page) => !rendered.has(page.localPath)).map((page) => page.localPath);
		return { published, skipped, permissions, cancelled: false };
	} catch (error) {
		if (options.signal?.aborted) {
			skipped = preflight.pages.filter((page) => !published.includes(page.localPath)).map((page) => page.localPath);
			return { published, skipped, permissions, cancelled: true };
		}
		throw error;
	} finally {
		activeDocuments.delete(project.remoteFileId);
	}
}

function flatten(root: LocalTreeResult["root"]): LocalTreeResult["root"][] {
	return [root, ...root.children.flatMap(flatten)];
}

function throwIfCancelled(signal?: AbortSignal): void {
	if (signal?.aborted) throw new Error("发布已取消。");
}

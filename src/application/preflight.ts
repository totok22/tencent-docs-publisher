import { convertMarkdownToMdx, type MarkdownAsset, type MarkdownConversion } from "../convert/markdown-to-mdx";
import { parseRemoteMdx, remoteContentFingerprint, type ParsedRemotePage } from "../convert/remote-mdx-parser";
import { sha256Hex } from "../domain/hash";
import { isWithinRoot } from "../domain/local-page-tree";
import { readCompletePage, type ToolJsonCaller } from "../tencent/smartcanvas";
import type { PublishProject, RemotePageBinding, RemoteTreeCache } from "../types";

export const CONVERTER_VERSION = "0.4.1";

export interface PreflightVaultReader {
	readMarkdown(path: string): Promise<string>;
	readBinary(path: string): Promise<ArrayBuffer>;
	resolvePath(target: string, sourcePath: string): string | null;
}

export type PagePreflightStatus = "changed" | "unchanged" | "conflict" | "unbound" | "error";

export interface PreparedAsset extends MarkdownAsset {
	contentHash: string;
	size: number;
}

export interface PagePreflight {
	localPath: string;
	status: PagePreflightStatus;
	sourceHash: string;
	remoteHash: string | null;
	remoteFresh: boolean;
	cacheFetchedAt: string | null;
	conversion: MarkdownConversion;
	assets: PreparedAsset[];
	warnings: string[];
	errors: string[];
	remoteContent: string | null;
	parsedRemote: ParsedRemotePage | null;
}

export async function preflightPage(
	reader: PreflightVaultReader,
	project: PublishProject,
	localPath: string,
	mode: "quick" | "refreshed",
	client?: ToolJsonCaller,
	cache?: RemoteTreeCache,
	embeddedMarkdownAsPage = project.embeddedMarkdownAsPage ?? false,
): Promise<PagePreflight> {
	const binding = project.pageMap[localPath];
	const sourceMarkdown = await reader.readMarkdown(localPath);
	const expanded = embeddedMarkdownAsPage
		? { markdown: sourceMarkdown, warnings: [] as string[] }
		: await expandMarkdownEmbeds(reader, sourceMarkdown, localPath, project.allowedRootPath, project.maxDepth);
	const markdown = expanded.markdown;
	const conversion = convertMarkdownToMdx(markdown, {
		resolvePath: (target) => reader.resolvePath(target, localPath),
		embeddedMarkdownAsPage,
	});
	const errors: string[] = [];
	const assets: PreparedAsset[] = [];
	for (const asset of conversion.assets) {
		if (!asset.resolvedPath) {
			errors.push(`资源无法解析：${asset.target}`);
			continue;
		}
		const bytes = await reader.readBinary(asset.resolvedPath);
		if (asset.kind === "image" && bytes.byteLength > 10 * 1024 * 1024) {
			errors.push(`图片超过 10 MB：${asset.resolvedPath}`);
		}
		assets.push({ ...asset, contentHash: await sha256Hex(bytes), size: bytes.byteLength });
	}
	const sourceHash = await sha256Hex(JSON.stringify({
		markdown,
		assets: assets.map((asset) => [asset.resolvedPath, asset.contentHash]),
		converterVersion: CONVERTER_VERSION,
		settings: { publicRead: project.publicRead, embeddedMarkdownAsPage },
	}));

	if (!binding) return result("unbound", null, false, null, null, null);
	let remoteHash: string | null = cache?.nodes[binding.pageId]?.contentFingerprint ?? null;
	let remoteContent: string | null = null;
	let parsedRemote: ParsedRemotePage | null = null;
	let remoteFresh = false;
	if (mode === "refreshed") {
		if (!client) throw new Error("刷新后预检需要腾讯文档客户端。");
		try {
			const read = await readCompletePage(client, project.remoteFileId, binding.pageId);
			remoteContent = read.content;
			parsedRemote = parseRemoteMdx(read.content, binding.pageId);
			remoteHash = await remoteContentFingerprint(read.content, binding.pageId);
			remoteFresh = true;
			if (parsedRemote.hasUnsafeSyntax) errors.push("远端页面包含无法安全解析的 MDX，已阻止写入。");
		} catch (error) {
			errors.push(error instanceof Error ? error.message : "远端页面读取失败。");
		}
	}
	const conflict = Boolean(binding.lastPublishedRemoteHash && remoteHash && binding.lastPublishedRemoteHash !== remoteHash);
	const unchanged = binding.lastPublishedSourceHash === sourceHash && !conflict;
	return result(errors.length ? "error" : conflict ? "conflict" : unchanged ? "unchanged" : "changed", remoteHash, remoteFresh, remoteContent, parsedRemote, binding);

	function result(
		status: PagePreflightStatus,
		calculatedRemoteHash: string | null,
		fresh: boolean,
		content: string | null,
		parsed: ParsedRemotePage | null,
		_binding: RemotePageBinding | null,
	): PagePreflight {
		return {
			localPath,
			status,
			sourceHash,
			remoteHash: calculatedRemoteHash,
			remoteFresh: fresh,
			cacheFetchedAt: cache?.fetchedAt ?? null,
			conversion,
			assets,
			warnings: [...expanded.warnings, ...conversion.warnings],
			errors,
			remoteContent: content,
			parsedRemote: parsed,
		};
	}
}

async function expandMarkdownEmbeds(
	reader: PreflightVaultReader,
	markdown: string,
	sourcePath: string,
	allowedRootPath: string,
	maxDepth: number,
	visited = new Set<string>([sourcePath]),
	depth = 0,
): Promise<{ markdown: string; warnings: string[] }> {
	const warnings: string[] = [];
	const pattern = /!\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
	let output = "";
	let cursor = 0;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(markdown)) !== null) {
		output += markdown.slice(cursor, match.index);
		cursor = pattern.lastIndex;
		const target = match[1] ?? "";
		const resolved = reader.resolvePath(target, sourcePath);
		if (!resolved?.toLowerCase().endsWith(".md")) {
			output += match[0];
			continue;
		}
		if (!isWithinRoot(resolved, allowedRootPath)) {
			warnings.push(`内嵌 Markdown 位于允许范围外：${resolved}`);
			output += `[内嵌范围外：${target}]`;
			continue;
		}
		if (visited.has(resolved)) {
			warnings.push(`内嵌 Markdown 循环：${resolved}`);
			output += `[内嵌循环：${target}]`;
			continue;
		}
		if (depth >= maxDepth) {
			warnings.push(`内嵌 Markdown 达到最大深度 ${maxDepth}：${resolved}`);
			output += `[内嵌深度上限：${target}]`;
			continue;
		}
		const nested = await reader.readMarkdown(resolved);
		const result = await expandMarkdownEmbeds(
			reader,
			stripEmbeddedFrontmatter(nested),
			resolved,
			allowedRootPath,
			maxDepth,
			new Set(visited).add(resolved),
			depth + 1,
		);
		warnings.push(...result.warnings);
		output += rewriteEmbeddedTargets(reader, result.markdown, resolved);
	}
	output += markdown.slice(cursor);
	return { markdown: output, warnings };
}

function rewriteEmbeddedTargets(reader: PreflightVaultReader, markdown: string, sourcePath: string): string {
	const wikiRewritten = markdown.replace(/(!?\[\[)([^\]|#]+)((?:#[^\]|]+)?(?:\|[^\]]+)?)\]\]/g, (whole, prefix: string, target: string, suffix: string) => {
		const resolved = reader.resolvePath(target, sourcePath);
		return resolved ? `${prefix}${resolved}${suffix}]]` : whole;
	});
	return wikiRewritten.replace(/(!?\[[^\]]*\]\()([^)#]+)((?:#[^)]*)?\))/g, (whole, prefix: string, target: string, suffix: string) => {
		if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return whole;
		const resolved = reader.resolvePath(target, sourcePath);
		return resolved ? `${prefix}${resolved}${suffix}` : whole;
	});
}

function stripEmbeddedFrontmatter(markdown: string): string {
	const normalized = markdown.replace(/\r\n?/g, "\n");
	if (!normalized.startsWith("---\n")) return normalized;
	const end = normalized.indexOf("\n---", 4);
	return end >= 0 ? normalized.slice(end + 4).replace(/^\n/, "") : normalized;
}

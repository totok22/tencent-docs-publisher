export interface LocalLink {
	rawTarget: string;
	displayText: string;
	resolvedPath: string | null;
	isEmbed: boolean;
	hasSubpath: boolean;
	position: number;
}

export interface LocalPageMetadata {
	path: string;
	title: string;
	aliases: string[];
	links: LocalLink[];
}

export interface LocalPageRepository {
	readPage(path: string): Promise<LocalPageMetadata>;
}

export interface LocalPageNode {
	path: string;
	title: string;
	aliases: string[];
	depth: number;
	children: LocalPageNode[];
}

export type LocalTreeDiagnosticKind =
	| "unresolved"
	| "out-of-scope"
	| "cycle"
	| "multiple-parent"
	| "max-depth"
	| "max-notes";

export interface LocalTreeDiagnostic {
	kind: LocalTreeDiagnosticKind;
	parentPath: string;
	target: string;
	message: string;
}

export interface LocalTreeResult {
	root: LocalPageNode;
	byPath: Record<string, LocalPageNode>;
	diagnostics: LocalTreeDiagnostic[];
	truncated: boolean;
}

export interface LocalTreeOptions {
	allowedRootPath: string;
	maxDepth: number;
	maxNotes: number;
	embeddedMarkdownAsPage: boolean;
}

export async function discoverLocalPageTree(
	repository: LocalPageRepository,
	rootPath: string,
	options: LocalTreeOptions,
): Promise<LocalTreeResult> {
	const byPath: Record<string, LocalPageNode> = {};
	const diagnostics: LocalTreeDiagnostic[] = [];
	const assigned = new Map<string, string | null>();
	let truncated = false;

	async function visit(path: string, parentPath: string | null, depth: number, ancestors: Set<string>): Promise<LocalPageNode> {
		const metadata = await repository.readPage(path);
		const node: LocalPageNode = { path, title: metadata.title, aliases: metadata.aliases, depth, children: [] };
		byPath[path] = node;
		assigned.set(path, parentPath);
		const nextAncestors = new Set(ancestors).add(path);

		for (const link of [...metadata.links].sort((a, b) => a.position - b.position)) {
			if (link.hasSubpath || (link.isEmbed && !options.embeddedMarkdownAsPage)) continue;
			if (!link.resolvedPath) {
				diagnostics.push({ kind: "unresolved", parentPath: path, target: link.rawTarget, message: "本地链接无法解析。" });
				continue;
			}
			if (!link.resolvedPath.toLowerCase().endsWith(".md")) continue;
			if (!isWithinRoot(link.resolvedPath, options.allowedRootPath)) {
				diagnostics.push({ kind: "out-of-scope", parentPath: path, target: link.resolvedPath, message: "链接位于允许根文件夹之外。" });
				continue;
			}
			if (nextAncestors.has(link.resolvedPath)) {
				diagnostics.push({ kind: "cycle", parentPath: path, target: link.resolvedPath, message: "检测到循环引用，不再展开。" });
				continue;
			}
			if (assigned.has(link.resolvedPath)) {
				diagnostics.push({ kind: "multiple-parent", parentPath: path, target: link.resolvedPath, message: "该页面已归属于首次遍历到的父页面。" });
				continue;
			}
			if (depth >= options.maxDepth) {
				truncated = true;
				diagnostics.push({ kind: "max-depth", parentPath: path, target: link.resolvedPath, message: `达到最大深度 ${options.maxDepth}。` });
				continue;
			}
			if (assigned.size >= options.maxNotes) {
				truncated = true;
				diagnostics.push({ kind: "max-notes", parentPath: path, target: link.resolvedPath, message: `达到最大页面数 ${options.maxNotes}。` });
				continue;
			}
			node.children.push(await visit(link.resolvedPath, path, depth + 1, nextAncestors));
		}
		return node;
	}

	const root = await visit(normalizePath(rootPath), null, 0, new Set());
	return { root, byPath, diagnostics, truncated };
}

export function isWithinRoot(path: string, rootPath: string): boolean {
	const pathParts = normalizePath(path).split("/");
	const root = normalizePath(rootPath).replace(/\/$/, "");
	if (!root) return true;
	const rootParts = root.split("/");
	return rootParts.every((part, index) => pathParts[index]?.toLocaleLowerCase() === part.toLocaleLowerCase());
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/");
}

const ASSET_PREFIX = "\u0000TD_ASSET_";
const ASSET_SUFFIX = "\u0000";
const PAGE_PREFIX = "\u0000TD_PAGE_";
const PAGE_SUFFIX = "\u0000";

export type AssetKind = "image" | "pdf";

export interface MarkdownAsset {
	index: number;
	kind: AssetKind;
	target: string;
	resolvedPath: string | null;
	label: string;
}

export interface MarkdownConversion {
	mdx: string;
	assets: MarkdownAsset[];
	pageLinks: MarkdownPageLink[];
	warnings: string[];
}

/** 正文里指向某个子页面的链接，用来决定这段正文该放在哪张子页面卡片附近。 */
export interface MarkdownPageLink {
	index: number;
	resolvedPath: string;
	label: string;
}

export interface MdxSegment {
	link: MarkdownPageLink | null;
	text: string;
}

export interface MarkdownConversionOptions {
	resolvePath: (target: string) => string | null;
	embeddedMarkdownAsPage?: boolean;
	/** 已绑定为子页面的本地 Markdown 路径；出现在正文里时会被标记位置。 */
	childPagePaths?: readonly string[];
}

export function convertMarkdownToMdx(markdown: string, options: MarkdownConversionOptions): MarkdownConversion {
	const assets: MarkdownAsset[] = [];
	const pageLinks: MarkdownPageLink[] = [];
	const childPagePaths = new Set(options.childPagePaths ?? []);
	const warnings: string[] = [];
	let text = stripFrontmatter(markdown.replace(/\r\n?/g, "\n")).replace(/%%[\s\S]*?%%/g, "");

	text = text.replace(/```(?:dataview|dataviewjs|canvas)([\s\S]*?)```/gi, (_whole, body: string) => {
		warnings.push("不执行 Dataview/Canvas 等插件内容，已按代码占位保留。");
		return `\`\`\`text\n[未执行的插件内容]\n${body.trim()}\n\`\`\``;
	});

	text = replaceTables(text);
	text = replaceCallouts(text);
	text = text.replace(/^\s*-\s+\[([ xX])\]\s+(.+)$/gm, (_whole, checked: string, body: string) =>
		`<Todo${checked.toLowerCase() === "x" ? " checked" : ""}>${body}</Todo>`,
	);
	text = text.replace(/==([^=\n]+)==/g, '<Mark backgroundColor="yellow">$1</Mark>');
	text = stripEmptyHeadings(text, warnings);

	const addAsset = (kind: AssetKind, target: string, label: string): string => {
		const cleanTarget = target.split("#")[0] ?? target;
		const index = assets.length;
		assets.push({ index, kind, target, resolvedPath: options.resolvePath(cleanTarget), label });
		return `${ASSET_PREFIX}${index}${ASSET_SUFFIX}`;
	};

	const addPageLink = (target: string, label: string): string | null => {
		if (!childPagePaths.size) return null;
		const resolved = options.resolvePath(target.split("#")[0] ?? target);
		if (!resolved || !childPagePaths.has(resolved)) return null;
		const index = pageLinks.length;
		pageLinks.push({ index, resolvedPath: resolved, label });
		return `${PAGE_PREFIX}${index}${PAGE_SUFFIX}`;
	};

	text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_whole, alt: string, target: string) => {
		if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return _whole;
		if (!isImage(target)) return _whole;
		return addAsset("image", target, alt || fileLabel(target));
	});
	text = text.replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (whole: string, target: string, alias?: string) => {
		const embedded = whole.startsWith("!");
		if (isImage(target)) return addAsset("image", target, alias ?? fileLabel(target));
		if (isPdf(target)) return addAsset("pdf", target, alias ?? fileLabel(target));
		if (embedded) {
			if (!options.embeddedMarkdownAsPage) warnings.push(`Markdown 嵌入“${target}”无法展开，已按文字占位。`);
			return `[内嵌：${alias ?? fileLabel(target)}]`;
		}
		const label = alias ?? fileLabel(target.split("#")[0] ?? target);
		return addPageLink(target, label) ?? label;
	});
	text = text.replace(/\[([^\]]+)\]\(([^)]+\.pdf(?:#[^)]+)?)\)/gi, (_whole, label: string, target: string) =>
		/^[a-z][a-z0-9+.-]*:/i.test(target) ? _whole : addAsset("pdf", target, label),
	);
	text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (whole: string, label: string, target: string) => {
		if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return whole;
		if (!options.resolvePath(target)?.toLowerCase().endsWith(".md")) return whole;
		return addPageLink(target, label) ?? label;
	});

	// Raw HTML/MDX from the source is never executed. Components generated above are restored afterward.
	const generated: string[] = [];
	text = text.replace(/<\/?(?:Table|TableRow|TableCell|Callout|MathBlock|Todo|Mark)\b[^>]*>/g, (tag) => {
		const index = generated.push(tag) - 1;
		return `\u0000TD_COMPONENT_${index}\u0000`;
	});
	if (/<[A-Za-z/][^>]*>/.test(text)) warnings.push("原始 HTML/MDX 已转义为纯文本。");
	text = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
	for (const [index, tag] of generated.entries()) {
		text = text.split(`\u0000TD_COMPONENT_${index}\u0000`).join(tag);
	}
	text = transformOutsideMarkdownLiterals(text, (plainText) =>
		plainText.replace(/\{/g, "&#123;").replace(/\}/g, "&#125;"),
	);
	// 块级公式改为 MathBlock 组件：腾讯文档对 $$...$$ 的解析不稳定，会出现随机 id 混入公式的情况。
	text = transformOutsideCode(text, (segment) =>
		segment.replace(/\$\$([^$]+)\$\$/g, (_whole, math: string) =>
			`<MathBlock>\n$$\n${math.trim()}\n$$\n</MathBlock>`,
		),
	);
	const outsideCode = transformOutsideCode(text, (segment) => segment);
	if (((outsideCode.match(/\$\$/g) ?? []).length % 2) === 1) {
		warnings.push("存在没有配对的 $$ 公式分隔符，已按原文写入，腾讯文档可能显示为普通文本。");
	}

	return { mdx: text.trim(), assets, pageLinks, warnings };
}

/**
 * 按子页面标记切分 MDX。标记必须独占一行才切分：表格、列表、段落里顺带提到的子页面链接
 * 不参与切分，避免把一个表格或列表拆成两半。
 */
export function splitPageLinkSegments(mdx: string, pageLinks: MarkdownPageLink[]): MdxSegment[] {
	if (!pageLinks.length) return [{ link: null, text: mdx }];
	const pattern = new RegExp(`${PAGE_PREFIX}(\\d+)${PAGE_SUFFIX}`, "g");
	const segments: MdxSegment[] = [];
	let current: MdxSegment = { link: null, text: "" };
	let cursor = 0;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(mdx)) !== null) {
		const link = pageLinks[Number(match[1])];
		const lineStart = mdx.lastIndexOf("\n", match.index - 1) + 1;
		const found = mdx.indexOf("\n", match.index);
		const lineEnd = found < 0 ? mdx.length : found;
		const lineWithoutMarker = mdx.slice(lineStart, match.index) + mdx.slice(pattern.lastIndex, lineEnd);
		if (!link || !/^\s*$/.test(lineWithoutMarker)) continue;
		current.text += mdx.slice(cursor, lineStart);
		segments.push(current);
		current = { link, text: "" };
		cursor = found < 0 ? lineEnd : lineEnd + 1;
	}
	current.text += mdx.slice(cursor);
	segments.push(current);
	return segments;
}

export function applyResolvedAssets(
	conversion: MarkdownConversion,
	resolved: Record<number, string>,
): string {
	return conversion.mdx.replace(new RegExp(`${ASSET_PREFIX}(\\d+)${ASSET_SUFFIX}`, "g"), (_whole, indexText: string) => {
		const index = Number(indexText);
		const asset = conversion.assets[index];
		const url = resolved[index];
		if (!asset || !url) throw new Error(`资源 ${index} 尚未解析。`);
		return asset.kind === "image"
			? `<Image src="${escapeAttribute(url)}" alt="${escapeAttribute(asset.label)}" />`
			: `[${escapeMarkdownLabel(asset.label)}](${url.replace(/\s/g, "%20")})`;
	});
}

export function validateGeneratedMdx(mdx: string): string[] {
	const errors: string[] = [];
	const withoutLiterals = transformOutsideMarkdownLiterals(mdx, (plainText) => plainText, "");
	if (/\{[\s\S]*?\}/.test(withoutLiterals)) errors.push("禁止 MDX 表达式。");
	const allowed = new Set(["Table", "TableRow", "TableCell", "Callout", "MathBlock", "Todo", "Mark", "Image"]);
	const tagPattern = /<\/?([A-Za-z][\w.-]*)([^>]*)>/g;
	let match: RegExpExecArray | null;
	while ((match = tagPattern.exec(withoutLiterals)) !== null) {
		const name = match[1];
		if (!name || !allowed.has(name)) errors.push(`未知 MDX 组件：${name ?? "?"}`);
		const attributes = match[2] ?? "";
		if (/\bon\w+\s*=|\b(?:src|href)\s*=\s*["']?javascript:/i.test(attributes)) errors.push("禁止可执行属性。");
		if (/\b(?:color|backgroundColor)\s*=/.test(attributes) && !/backgroundColor="(?:yellow|red|blue|green|gray)"/.test(attributes)) {
			errors.push("包含不受支持的颜色值。");
		}
	}
	return [...new Set(errors)];
}

function transformOutsideMarkdownLiterals(
	text: string,
	transform: (plainText: string) => string,
	literalReplacement?: string,
): string {
	const literalPattern = /```[\s\S]*?```|`[^`\n]*`|\$\$[\s\S]*?\$\$|(?<!\\)\$(?!\$)(?:\\.|[^$\n\\])+(?<!\\)\$/g;
	let output = "";
	let cursor = 0;
	let match: RegExpExecArray | null;
	while ((match = literalPattern.exec(text)) !== null) {
		output += transform(text.slice(cursor, match.index));
		output += literalReplacement ?? match[0];
		cursor = literalPattern.lastIndex;
	}
	return output + transform(text.slice(cursor));
}

function stripFrontmatter(markdown: string): string {
	if (!markdown.startsWith("---\n")) return markdown;
	const end = markdown.indexOf("\n---", 4);
	return end >= 0 ? markdown.slice(end + 4).replace(/^\n/, "") : markdown;
}

/** 只在代码块与行内代码之外应用转换，避免改写 `` `$$x$$` `` 这类代码示例。 */
function transformOutsideCode(text: string, transform: (plainText: string) => string): string {
	const codePattern = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g;
	let output = "";
	let cursor = 0;
	let match: RegExpExecArray | null;
	while ((match = codePattern.exec(text)) !== null) {
		output += transform(text.slice(cursor, match.index));
		output += match[0];
		cursor = codePattern.lastIndex;
	}
	return output + transform(text.slice(cursor));
}

function stripEmptyHeadings(text: string, warnings: string[]): string {
	const output: string[] = [];
	let removed = 0;
	let fence: string | null = null;
	for (const line of text.split("\n")) {
		const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
		if (fenceMatch) {
			const marker = fenceMatch[1]?.[0] ?? "`";
			fence = fence === null ? marker : fence === marker ? null : fence;
			output.push(line);
			continue;
		}
		if (fence === null && /^#{1,6}[ \t]*$/.test(line)) {
			removed += 1;
			continue;
		}
		output.push(line);
	}
	if (removed > 0) {
		warnings.push(`已跳过 ${removed} 个空标题：腾讯文档会把空标题渲染成"标题 N"占位符，请在源文件中补全标题文字或删除该行。`);
	}
	return output.join("\n");
}

function replaceTables(text: string): string {
	const lines = text.split("\n");
	const output: string[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const header = lines[index];
		const separator = lines[index + 1];
		if (header?.includes("|") && separator && /^\s*\|?\s*:?-{2,}/.test(separator)) {
			const rows = [header];
			index += 2;
			while (index < lines.length && lines[index]?.includes("|")) {
				rows.push(lines[index] ?? "");
				index += 1;
			}
			index -= 1;
			output.push(`<Table>${rows.map((row) => `<TableRow>${splitCells(row).map((cell) => `<TableCell>${cell}</TableCell>`).join("")}</TableRow>`).join("")}</Table>`);
		} else if (header !== undefined) output.push(header);
	}
	return output.join("\n");
}

function replaceCallouts(text: string): string {
	const lines = text.split("\n");
	const output: string[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const match = lines[index]?.match(/^>\s*\[!([A-Za-z]+)\][+-]?\s*(.*)$/);
		if (!match) {
			output.push(lines[index] ?? "");
			continue;
		}
		const body: string[] = [];
		while (lines[index + 1]?.startsWith(">")) {
			index += 1;
			body.push((lines[index] ?? "").replace(/^>\s?/, ""));
		}
		output.push(`<Callout type="${escapeAttribute((match[1] ?? "note").toLowerCase())}" title="${escapeAttribute(match[2] ?? "")}">${body.join("\n")}</Callout>`);
	}
	return output.join("\n");
}

function splitCells(row: string): string[] {
	return row.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((cell) => cell.trim());
}

function isImage(target: string): boolean {
	return /\.(?:png|jpe?g|gif|bmp|webp|svg)(?:#.*)?$/i.test(target);
}

function isPdf(target: string): boolean {
	return /\.pdf(?:#.*)?$/i.test(target);
}

function fileLabel(target: string): string {
	return (target.split("/").pop() ?? target).replace(/\.md$/i, "");
}

function escapeAttribute(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeMarkdownLabel(value: string): string {
	return value.replace(/[[\]]/g, "\\$&");
}

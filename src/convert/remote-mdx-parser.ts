import { normalizeSemanticWhitespace, sha256Hex } from "../domain/hash";

const WRITABLE_BLOCKS = new Set([
	"Paragraph", "Heading", "BulletedList", "NumberedList", "Todo", "Blockquote", "BlockQuote", "CodeBlock",
	"Divider", "Table", "Callout", "MathBlock", "Image", "Text", "ColumnList",
]);

export interface MdxElement {
	name: string;
	attributes: Record<string, string>;
	start: number;
	end: number;
	raw: string;
	children: MdxElement[];
	parent: MdxElement | null;
}

export interface RemoteContentBlock {
	id: string | null;
	type: string;
	raw: string;
	preserve: boolean;
	reason: "page" | "readonly" | "unsupported" | null;
}

export interface ParsedRemotePage {
	pageId: string | null;
	blocks: RemoteContentBlock[];
	directChildPages: Array<{ pageId: string; title: string; raw: string }>;
	allPageElements: MdxElement[];
	hasUnsafeSyntax: boolean;
}

/** Parses the XML-like block envelope without evaluating any MDX expressions. */
export function parseRemoteMdx(content: string, expectedPageId?: string): ParsedRemotePage {
	const { roots, unsafe } = parseElements(content);
	const pages = flatten(roots).filter((element) => element.name === "Page");
	const wrapper =
		pages.find((page) => page.attributes.id === expectedPageId) ??
		(roots.length === 1 && roots[0]?.name === "Page" ? roots[0] : null);
	const blockElements = wrapper ? wrapper.children : roots;
	const directPages = blockElements.filter((element) => element.name === "Page");

	return {
		pageId: wrapper?.attributes.id ?? expectedPageId ?? null,
		blocks: blockElements.map(toBlock),
		directChildPages: directPages
			.map((page) => ({
				pageId: page.attributes.id ?? "",
				title: page.attributes.title ?? page.attributes.name ?? extractPageTitle(page),
				raw: page.raw,
			}))
			.filter((page) => page.pageId.length > 0),
		allPageElements: pages,
		hasUnsafeSyntax: unsafe,
	};
}

export async function remoteContentFingerprint(content: string, expectedPageId?: string): Promise<string> {
	const parsed = parseRemoteMdx(content, expectedPageId);
	const canonical = parsed.blocks
		.map((block) => {
			if (block.reason === "page") {
				const id = readAttribute(block.raw, "id") ?? "missing";
				return `<Page id="${escapeAttribute(id)}" />`;
			}
			return normalizeSemanticWhitespace(stripVolatileBlockId(block.raw));
		})
		.join("\n");
	return sha256Hex(canonical);
}

function stripVolatileBlockId(raw: string): string {
	return raw.replace(/\s+id\s*=\s*(?:"[^"]*"|'[^']*'|\{[^{}]*\})/i, "");
}

export function findWritableAnchor(parsed: ParsedRemotePage): RemoteContentBlock | null {
	return parsed.blocks.find((block) => block.id !== null && !block.preserve) ??
		parsed.blocks.find((block) => block.id !== null && block.reason === "page") ??
		null;
}

function toBlock(element: MdxElement): RemoteContentBlock {
	const readonly = /^(?:true|1)$/i.test(element.attributes.readonly ?? "") || element.name === "Readonly";
	const page = element.name === "Page";
	const unsupported = !page && !readonly && !WRITABLE_BLOCKS.has(element.name);
	return {
		id: element.attributes.id ?? null,
		type: element.name,
		raw: element.raw,
		preserve: page || readonly || unsupported,
		reason: page ? "page" : readonly ? "readonly" : unsupported ? "unsupported" : null,
	};
}

function parseElements(content: string): { roots: MdxElement[]; unsafe: boolean } {
	const roots: MdxElement[] = [];
	const stack: Array<Omit<MdxElement, "end" | "raw">> = [];
	const tagPattern = /<\/?([A-Za-z][\w.-]*)(?:\s[^<>]*?)?\/?>/g;
	let match: RegExpExecArray | null;
	let unsafe = false;

	while ((match = tagPattern.exec(content)) !== null) {
		const token = match[0];
		const name = match[1];
		if (!name) continue;
		const closing = token.startsWith("</");
		const selfClosing = token.endsWith("/>");
		if (closing) {
			const open = stack.pop();
			if (!open || open.name !== name) {
				unsafe = true;
				stack.length = 0;
				continue;
			}
			const element: MdxElement = {
				...open,
				end: tagPattern.lastIndex,
				raw: content.slice(open.start, tagPattern.lastIndex),
			};
			attachElement(element, roots, stack);
			continue;
		}

		const partial = {
			name,
			attributes: parseAttributes(token),
			start: match.index,
			children: [] as MdxElement[],
			parent: null as MdxElement | null,
		};
		if (selfClosing) {
			attachElement({ ...partial, end: tagPattern.lastIndex, raw: token }, roots, stack);
		} else {
			stack.push(partial);
		}
	}
	if (stack.length > 0) unsafe = true;
	return { roots, unsafe };
}

function attachElement(
	element: MdxElement,
	roots: MdxElement[],
	stack: Array<Omit<MdxElement, "end" | "raw">>,
): void {
	const parent = stack[stack.length - 1];
	if (!parent) {
		roots.push(element);
		return;
	}
	element.parent = parent as MdxElement;
	parent.children.push(element);
}

function parseAttributes(tag: string): Record<string, string> {
	const attributes: Record<string, string> = {};
	const attributePattern = /\s([A-Za-z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^{}]*)\}|([^\s>]+)))?/g;
	let match: RegExpExecArray | null;
	while ((match = attributePattern.exec(tag)) !== null) {
		const key = match[1];
		if (key) attributes[key] = match[2] ?? match[3] ?? match[4] ?? match[5] ?? "true";
	}
	return attributes;
}

function flatten(elements: MdxElement[]): MdxElement[] {
	const output: MdxElement[] = [];
	for (const element of elements) {
		output.push(element, ...flatten(element.children));
	}
	return output;
}

function readAttribute(raw: string, name: string): string | null {
	return parseAttributes(raw.slice(0, raw.indexOf(">") + 1))[name] ?? null;
}

function extractPageTitle(page: MdxElement): string {
	const heading = page.raw.match(/<Heading\b[^>]*>([\s\S]*?)<\/Heading>/i)?.[1];
	const headingText = heading?.replace(/<[^>]+>/g, "").trim();
	if (headingText) return headingText;

	const openingEnd = page.raw.indexOf(">") + 1;
	const closingStart = page.raw.lastIndexOf("</Page");
	if (openingEnd <= 0 || closingStart < openingEnd) return "未命名页面";
	let cursor = openingEnd;
	let directText = "";
	for (const child of page.children) {
		const childStart = child.start - page.start;
		const childEnd = child.end - page.start;
		if (childStart >= cursor) directText += page.raw.slice(cursor, childStart);
		cursor = Math.max(cursor, childEnd);
	}
	directText += page.raw.slice(cursor, closingStart);
	return directText.replace(/\s+/g, " ").trim() || "未命名页面";
}

function escapeAttribute(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

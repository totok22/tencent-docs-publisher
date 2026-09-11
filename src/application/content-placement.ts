	import { splitPageLinkSegments, type MarkdownPageLink } from "../convert/markdown-to-mdx";
import type { ParsedRemotePage } from "../convert/remote-mdx-parser";
import type { PublishProject } from "../types";

export interface ContentInsert {
	/** 插入锚点 Block ID；null 表示文档末尾追加（只在页面没有任何可写块时使用）。 */
	anchorId: string | null;
	text: string;
}

export interface ContentPlacement {
	inserts: ContentInsert[];
	warnings: string[];
}

/** PagePreflight 里参与“能不能写”判断的那部分字段。 */
export interface WritableCheckInput {
	localPath: string;
	conversion: { mdx: string };
	parsedRemote: ParsedRemotePage | null;
}

/**
 * smartcanvas.edit 没有页面参数：正文只会落进"锚点 Block 所属的页面"。
 *
 * 实测（2026-09-11）：
 * - 用子页面内部的普通块当锚点，INSERT_BEFORE 会准确写进该子页面；
 * - 用 <Page> 块当锚点会被拒绝（cannot insert content at page block）；
 * - 传 page_id 会被忽略，不带锚点的 INSERT_AFTER 追加到文档末尾，也就是根页面。
 *
 * 因此子页面必须有自己的普通块才能写入；否则返回需要用户先补一个占位段落的说明。
 */
export function describeUnwritablePage(project: PublishProject, page: WritableCheckInput): string | null {
	const binding = project.pageMap[page.localPath];
	if (!binding || !page.parsedRemote) return null;
	if (binding.pageId === project.remoteRootPageId) return null;
	if (!page.conversion.mdx.trim()) return null;
	const hasOwnBlock = page.parsedRemote.blocks.some((block) => block.id && !block.preserve);
	if (hasOwnBlock) return null;
	return `子页面"${binding.remoteTitle || binding.localTitle}"在腾讯文档里还没有正文，接口找不到可以定位的插入点。请先在该子页面里输入任意一个字符作为占位，发布后插件会自动删掉它。`;
}

/**
 * 把正文按本地链接里子页面出现的位置切成若干段，并算好每段的插入锚点。
 *
 * 腾讯接口不能把内容插到子页面卡片旁边，所以只有当卡片后面跟着普通内容块时，
 * 该卡片之后的正文才能精确落到卡片下方；否则这段正文会顺延到下一个能插入的位置，
 * 并给出一条"请拖动卡片"的提示。
 */
export function planContentPlacement(
	/** 已经替换过图片/附件占位符的最终 MDX。 */
	mdx: string,
	pageLinks: MarkdownPageLink[],
	parsed: ParsedRemotePage,
	project: PublishProject,
): ContentPlacement {
	const warnings: string[] = [];
	const cardTitles = new Map(parsed.directChildPages.map((page) => [page.pageId, page.title]));
	const firstCardIndex = parsed.blocks.findIndex((block) => block.reason === "page");

	const segments = splitPageLinkSegments(mdx, pageLinks);
	const buckets: Array<{ card: string | null; text: string }> = [];
	let bucketCard: string | null = null;
	let bucketText = "";
	const flush = (): void => {
		const text = bucketText.trim();
		if (text) buckets.push({ card: bucketCard, text });
		bucketText = "";
	};
	for (const segment of segments) {
		if (segment.link) {
			const pageId = project.pageMap[segment.link.resolvedPath]?.pageId;
			if (pageId && cardTitles.has(pageId)) {
				flush();
				bucketCard = pageId;
			} else {
				bucketText += `${segment.link.label}\n\n`;
			}
		}
		bucketText += segment.text;
	}
	flush();

	/** 卡片之后第一个可写块；同时报告中间还夹着哪些卡片（夹住的卡片无法插入内容）。 */
	const anchorAfterCard = (cardId: string): { anchorId: string; skipped: string[] } | undefined => {
		const at = parsed.blocks.findIndex((block) => block.id === cardId);
		if (at < 0) return undefined;
		const skipped: string[] = [];
		for (let index = at + 1; index < parsed.blocks.length; index += 1) {
			const block = parsed.blocks[index];
			if (!block) continue;
			if (block.reason === "page" && block.id) skipped.push(block.id);
			if (block.reason === null && block.id) return { anchorId: block.id, skipped };
		}
		return undefined;
	};
	const anchorBeforeFirstCard = (): string | null | undefined => {
		const limit = firstCardIndex < 0 ? parsed.blocks.length : firstCardIndex;
		for (let index = 0; index < limit; index += 1) {
			const block = parsed.blocks[index];
			if (block && block.reason === null && block.id) return block.id;
		}
		return undefined;
	};

	const inserts: ContentInsert[] = [];
	let pending = "";
	for (const bucket of buckets) {
		const text = pending ? `${pending}\n\n${bucket.text}` : bucket.text;
		const found = bucket.card ? anchorAfterCard(bucket.card) : undefined;
		const anchor = bucket.card ? found?.anchorId : anchorBeforeFirstCard();
		if (anchor === undefined) {
			pending = text;
			if (bucket.card) {
				warnings.push(placementWarning(cardTitles, bucket.card));
			}
			continue;
		}
		if (found?.skipped.length) warnings.push(placementWarning(cardTitles, bucket.card!, found.skipped[0]));
		pending = "";
		inserts.push({ anchorId: anchor, text });
	}
	if (pending.trim()) {
		const last = inserts[inserts.length - 1];
		if (last) last.text = `${last.text}\n\n${pending}`;
		else inserts.push({ anchorId: null, text: pending });
	}
	return { inserts, warnings: [...new Set(warnings)] };
}

function placementWarning(
	cardTitles: Map<string, string>,
	cardId: string,
	blockedBy?: string,
): string {
	const title = cardTitles.get(cardId) ?? "子页面";
	const blocker = blockedBy ? cardTitles.get(blockedBy) ?? "另一张卡片" : "";
	const reason = blockedBy
		? `"${title}"和"${blocker}"卡片连在一起，腾讯接口不允许在两张卡片之间插入内容，所以把正文排到了"${blocker}"之后。`
		: `"${title}"卡片后面没有可插入的位置。`;
	return `本地链接"${title}"附近的正文没能排在卡片旁边：${reason}请在腾讯文档里把卡片拖到正文该在的位置，再重新发布会按新位置排版。`;
}

/** 占位符没有解析干净时立刻报错，避免把内部标记写进腾讯文档。 */
export function assertNoPlaceholders(text: string): void {
	if (text.includes("\u0000TD_")) throw new Error("内部错误：正文里还有未替换的图片/附件占位符，已停止写入。");
}

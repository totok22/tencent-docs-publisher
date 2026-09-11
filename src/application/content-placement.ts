import { splitPageLinkSegments, type MarkdownPageLink } from "../convert/markdown-to-mdx";
import type { ParsedRemotePage } from "../convert/remote-mdx-parser";
import type { PublishProject } from "../types";

export interface ContentInsert {
	/** 插入锚点 Block ID；null 表示追加到文档末尾（仅限根页面，且此时卡片就是最后一块）。 */
	anchorId: string | null;
	/** 锚点为普通块时，插到它前面还是后面。anchorId 为 null 时忽略。 */
	position: "before" | "after";
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
 * smartcanvas.edit 没有页面参数：正文只会落进“锚点 Block 所属的页面”。
 *
 * 实测（2026-09-11，两篇真实文档）：
 * - 用子页面内部的普通块当锚点，INSERT_BEFORE/INSERT_AFTER 会准确写进那个子页面；
 * - 用 <Page> 卡片当锚点会被拒绝（cannot insert content at page block），两个方向都一样；
 * - 传 page_id 会被忽略；不带锚点的 INSERT_AFTER 追加到文档末尾，也就是根页面。
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
	return `子页面“${binding.remoteTitle || binding.localTitle}”在腾讯文档里还没有正文，接口找不到可以定位的插入点。请先在该子页面里输入任意一个字符作为占位，发布后插件会自动删掉它。`;
}

/**
 * 把正文按本地链接里子页面出现的位置切成若干段，并给每一段算一个合法插入点。
 *
 * 关键约束：卡片本身不能当锚点，所以插件只能“贴着一块普通内容”插入。
 * - 卡片后面跟着普通块：正文插在那一块之前，正好落在卡片下方；
 * - 两张卡片紧挨着（中间没有任何普通块）：这一段没有合法落点，会顺延到后面并给出提示；
 * - 卡片是页面最后一块：根页面可以追加到文档末尾（正好在卡片下方），子页面不行，只能插到卡片上方并提示。
 */
export function planContentPlacement(
	/** 已经替换过图片/附件占位符的最终 MDX。 */
	mdx: string,
	pageLinks: MarkdownPageLink[],
	parsed: ParsedRemotePage,
	project: PublishProject,
	/** 当前发布的是不是文档根页面（决定能不能追加到文档末尾）。 */
	isRootPage: boolean,
): ContentPlacement {
	const warnings: string[] = [];
	const cardTitles = new Map(parsed.directChildPages.map((page) => [page.pageId, page.title]));
	const firstCardIndex = parsed.blocks.findIndex((block) => block.reason === "page");
	const firstCardId = firstCardIndex >= 0 ? parsed.blocks[firstCardIndex]?.id ?? null : null;
	const firstWritableId = parsed.blocks.find((block) => block.reason === null && block.id)?.id ?? null;
	const lastBlock = parsed.blocks[parsed.blocks.length - 1] ?? null;

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

	/** 卡片之后第一个可写块；同时报告中间还夹着哪些卡片。 */
	const anchorAfterCard = (cardId: string): { anchorId: string; skippedCards: string[] } | null => {
		const at = parsed.blocks.findIndex((block) => block.id === cardId);
		if (at < 0) return null;
		const skippedCards: string[] = [];
		for (let index = at + 1; index < parsed.blocks.length; index += 1) {
			const block = parsed.blocks[index];
			if (!block) continue;
			if (block.reason === "page" && block.id) {
				skippedCards.push(block.id);
				continue;
			}
			if (block.reason === null && block.id) return { anchorId: block.id, skippedCards };
		}
		return null;
	};

	/** 指定卡片之前最后一个可写块（把正文插到它后面，就等于紧贴卡片上方）。 */
	const anchorBeforeCard = (cardId: string | null): string | null => {
		const limit = cardId ? parsed.blocks.findIndex((block) => block.id === cardId) : firstCardIndex;
		if (limit < 0) return null;
		let found: string | null = null;
		for (let index = 0; index < limit; index += 1) {
			const block = parsed.blocks[index];
			if (block && block.reason === null && block.id) found = block.id;
		}
		return found;
	};

	const inserts: ContentInsert[] = [];
	for (const bucket of buckets) {
		if (bucket.card) {
			const found = anchorAfterCard(bucket.card);
			if (found) {
				inserts.push({ anchorId: found.anchorId, position: "before", text: bucket.text });
				if (found.skippedCards.length) {
					const blocker = found.skippedCards[0];
					if (blocker) warnings.push(adjacentCardsWarning(cardTitles, bucket.card, blocker));
				}
				continue;
			}
			if (isRootPage && lastBlock?.reason === "page" && lastBlock.id === bucket.card) {
				// 卡片是文档最后一块：追加到文档末尾正好落在卡片下方。
				inserts.push({ anchorId: null, position: "after", text: bucket.text });
				continue;
			}
			const above = anchorBeforeCard(bucket.card);
			if (above) {
				// 卡片下方没有合法落点，只能贴近卡片上方插入。
				inserts.push({ anchorId: above, position: "after", text: bucket.text });
				warnings.push(belowCardWarning(cardTitles, bucket.card));
				continue;
			}
			// 连卡片上方也没有可写块：根页面就追加到末尾（内容留在本页），子页面只报警告。
			if (isRootPage) inserts.push({ anchorId: null, position: "after", text: bucket.text });
			warnings.push(belowCardWarning(cardTitles, bucket.card));
			continue;
		}
		const anchor = anchorBeforeCard(firstCardId);
		if (anchor) {
			inserts.push({ anchorId: anchor, position: "before", text: bucket.text });
			continue;
		}
		if (firstCardIndex < 0) {
			// 页面里没有卡片：正文直接排在顶部，不需要任何提示。
			if (firstWritableId) inserts.push({ anchorId: firstWritableId, position: "before", text: bucket.text });
			else if (isRootPage) inserts.push({ anchorId: null, position: "after", text: bucket.text });
			continue;
		}
		if (firstWritableId) {
			// 卡片是页面第一块，正文只能先落在卡片下方。
			inserts.push({ anchorId: firstWritableId, position: "before", text: bucket.text });
			warnings.push(aboveCardWarning(cardTitles, firstCardId));
			continue;
		}
		if (isRootPage) inserts.push({ anchorId: null, position: "after", text: bucket.text });
		else warnings.push(aboveCardWarning(cardTitles, firstCardId));
	}
	return { inserts, warnings: [...new Set(warnings)] };
}

function adjacentCardsWarning(
	cardTitles: Map<string, string>,
	cardId: string,
	blockedBy: string,
): string {
	const title = cardTitles.get(cardId) ?? "子页面";
	const blocker = cardTitles.get(blockedBy) ?? "另一张卡片";
	return `本地链接“${title}”后面的正文没能排在卡片旁边：“${title}”和“${blocker}”两张卡片紧挨在一起，腾讯接口不允许在卡片之间插入内容，所以这段正文排到了“${blocker}”后面。想让它回到两张卡片之间，请在腾讯文档里把“${blocker}”卡片往下拖一点，再重新发布。`;
}

function belowCardWarning(cardTitles: Map<string, string>, cardId: string): string {
	const title = cardTitles.get(cardId) ?? "子页面";
	return `本地链接“${title}”后面的正文没能排在卡片下方：“${title}”卡片已经是这一页的最后一块，腾讯接口又只能在已有内容旁边插入，所以这段正文排到了卡片上方。请在腾讯文档里删掉卡片后面的空行，或在卡片下方先写一个字，再重新发布。`;
}

function aboveCardWarning(cardTitles: Map<string, string>, cardId: string | null): string {
	const title = cardId ? cardTitles.get(cardId) ?? "子页面" : "子页面";
	return `本地链接之前的正文没能排在“${title}”卡片上方：卡片已经是这一页的第一块，腾讯接口无法在卡片上方插入内容，所以这段正文排到了卡片下方。请在腾讯文档里把“${title}”卡片往下拖一点，再重新发布。`;
}

/** 占位符没有解析干净时立刻报错，避免把内部标记写进腾讯文档。 */
export function assertNoPlaceholders(text: string): void {
	if (text.includes("\u0000TD_")) throw new Error("内部错误：正文里还有未替换的图片/附件占位符，已停止写入。");
}


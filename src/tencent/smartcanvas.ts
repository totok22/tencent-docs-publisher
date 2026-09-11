import { PublisherError } from "./errors";

export interface ToolJsonCaller {
	callToolJson<T>(name: string, args?: Record<string, unknown>, stage?: string): Promise<T>;
}

export interface SmartcanvasPageRead {
	content: string;
	pageCount: number;
	pageId: string | null;
}

interface ReadResponse {
	content?: string;
	next_token?: string;
	page_id?: string;
}

export async function readCompletePage(
	client: ToolJsonCaller,
	fileId: string,
	pageId?: string,
	maxPages = 1_000,
): Promise<SmartcanvasPageRead> {
	const chunks: string[] = [];
	const seenTokens = new Set<string>();
	let token: string | undefined;
	let returnedPageId: string | null = pageId ?? null;

	for (let page = 0; page < maxPages; page += 1) {
		const args: Record<string, unknown> = { file_id: fileId, size: 20 };
		if (pageId) args.page_id = pageId;
		if (token) args.next_token = token;
		const response = await client.callToolJson<ReadResponse>("smartcanvas.read", args, "read-page");
		if (typeof response.content === "string") chunks.push(response.content);
		if (typeof response.page_id === "string") returnedPageId = response.page_id;
		if (!response.next_token) {
			return { content: chunks.join("\n"), pageCount: page + 1, pageId: returnedPageId };
		}
		if (seenTokens.has(response.next_token)) {
			throw new PublisherError("分页游标重复，已停止读取以避免死循环。", "PROTOCOL", "read-page");
		}
		seenTokens.add(response.next_token);
		token = response.next_token;
	}
	throw new PublisherError(`页面分页超过安全上限 ${maxPages}。`, "PROTOCOL", "read-page");
}

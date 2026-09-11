import type { ToolJsonCaller } from "./smartcanvas";

export interface RemoteDocumentChoice {
	fileId: string;
	title: string;
	url: string;
}

const RECENT_PAGE_SIZE = 20;
const MAX_RECENT_PAGES = 5;
const MAX_CHOICES = 20;

export async function findSmartcanvasDocuments(
	client: ToolJsonCaller,
	query?: string,
): Promise<RemoteDocumentChoice[]> {
	if (query) {
		const response = await client.callToolJson<Record<string, unknown>>(
			"manage.search_file",
			{ search_key: query },
			"search-documents",
		);
		return collectChoices(client, arrayField(response, ["list", "files", "file"]));
	}

	const choices: RemoteDocumentChoice[] = [];
	const seen = new Set<string>();
	for (let page = 1; page <= MAX_RECENT_PAGES && choices.length < MAX_CHOICES; page += 1) {
		const response = await client.callToolJson<Record<string, unknown>>(
			"manage.recent_online_file",
			{ num: page, count: RECENT_PAGE_SIZE, order_by: 0 },
			"recent-documents",
		);
		const items = arrayField(response, ["files", "file", "list"]);
		const pageChoices = await collectChoices(client, items, seen);
		choices.push(...pageChoices.slice(0, MAX_CHOICES - choices.length));
		if (items.length < RECENT_PAGE_SIZE) break;
	}
	return choices;
}

async function collectChoices(
	client: ToolJsonCaller,
	items: unknown[],
	seen = new Set<string>(),
): Promise<RemoteDocumentChoice[]> {
	const choices: RemoteDocumentChoice[] = [];
	for (const item of items) {
		const record = asRecord(item);
		if (!record) continue;
		const fileId = stringField(record, ["file_id", "fileId", "id"]);
		if (!fileId || seen.has(fileId)) continue;
		seen.add(fileId);

		const hint = smartcanvasHint(record);
		if (hint === false) continue;
		if (hint === true) {
			choices.push(toChoice(record, fileId));
			continue;
		}

		try {
			const info = await client.callToolJson<Record<string, unknown>>(
				"manage.query_file_info",
				{ file_id: fileId },
				"filter-smartcanvas",
			);
			if (stringField(info, ["type", "file_type", "fileType"]) !== "smartcanvas") continue;
			choices.push(toChoice({ ...record, ...info }, fileId));
		} catch {
			// Inaccessible and unrecognized results are intentionally omitted.
		}
	}
	return choices;
}

function smartcanvasHint(record: Record<string, unknown>): boolean | null {
	const type = stringField(record, ["type", "ext", "file_type", "fileType"]);
	if (type) return type === "smartcanvas";
	const url = stringField(record, ["url", "file_url", "fileUrl"]);
	if (!url) return null;
	try {
		const parsed = new URL(url);
		if (parsed.hostname !== "docs.qq.com") return null;
		return parsed.pathname.startsWith("/aio/");
	} catch {
		return null;
	}
}

function toChoice(record: Record<string, unknown>, fileId: string): RemoteDocumentChoice {
	return {
		fileId,
		title: stringField(record, ["title", "file_name", "fileName", "name"]) ?? fileId,
		url: stringField(record, ["url", "file_url", "fileUrl"]) ?? "",
	};
}

function arrayField(record: Record<string, unknown>, keys: string[]): unknown[] {
	for (const key of keys) if (Array.isArray(record[key])) return record[key];
	return [];
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

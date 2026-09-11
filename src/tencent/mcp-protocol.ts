import { PublisherError } from "./errors";

export interface JsonRpcRequest {
	jsonrpc: "2.0";
	id?: number;
	method: string;
	params?: unknown;
}

export interface JsonRpcResponse {
	jsonrpc?: string;
	id?: number | null;
	result?: unknown;
	error?: { code?: number; message?: string; data?: unknown };
}

export function parseMcpResponse(text: string, contentType: string, expectedId?: number): JsonRpcResponse | null {
	if (!text.trim()) return null;
	if (contentType.toLowerCase().includes("text/event-stream")) {
		const messages = parseSseData(text).map(parseJsonRpc);
		if (expectedId !== undefined) {
			for (let index = messages.length - 1; index >= 0; index -= 1) {
				if (messages[index]?.id === expectedId) return messages[index] ?? null;
			}
			return null;
		}
		return messages[messages.length - 1] ?? null;
	}
	return parseJsonRpc(text);
}

export function parseSseData(text: string): string[] {
	const events: string[] = [];
	for (const block of text.split(/\r?\n\r?\n/)) {
		const data = block
			.split(/\r?\n/)
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trimStart())
			.join("\n");
		if (data && data !== "[DONE]") events.push(data);
	}
	return events;
}

function parseJsonRpc(text: string): JsonRpcResponse {
	try {
		const value: unknown = JSON.parse(text);
		if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("not an object");
		return value;
	} catch {
		throw new PublisherError("MCP 响应不是有效的 JSON-RPC 对象。", "PROTOCOL", "parse-response");
	}
}

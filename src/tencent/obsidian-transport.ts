import { requestUrl } from "obsidian";
import type { McpTransport } from "./mcp-client";

export const obsidianMcpTransport: McpTransport = async (request) => {
	const response = await requestUrl({
		url: request.url,
		method: "POST",
		headers: request.headers,
		body: request.body,
		throw: false,
	});
	return { status: response.status, headers: response.headers, text: response.text };
};

import { TENCENT_MCP_ENDPOINT } from "../types";
import { classifyHttpError, PublisherError } from "./errors";
import { parseMcpResponse, type JsonRpcRequest, type JsonRpcResponse } from "./mcp-protocol";

export interface TransportRequest {
	url: string;
	headers: Record<string, string>;
	body: string;
}

export interface TransportResponse {
	status: number;
	headers: Record<string, string>;
	text: string;
}

export type McpTransport = (request: TransportRequest) => Promise<TransportResponse>;

export interface McpToolDefinition {
	name: string;
	description?: string;
	inputSchema?: unknown;
}

export interface ConnectionIdentity {
	accountId: string;
	displayName: string;
	serverName: string;
}

export class TencentMcpClient {
	private sessionId: string | null = null;
	private nextId = 1;
	private initialized = false;
	private serverName = "Tencent Docs";

	constructor(
		private readonly token: string,
		private readonly transport: McpTransport,
		private readonly timeoutMs = 30_000,
	) {}

	async initialize(): Promise<void> {
		if (this.initialized) return;
		const response = await this.send({
			jsonrpc: "2.0",
			id: this.nextId++,
			method: "initialize",
			params: {
				protocolVersion: "2025-06-18",
				capabilities: {},
				clientInfo: { name: "tencent-docs-publisher", version: "0.1.0" },
			},
		}, "initialize");
		const result = asRecord(response?.result);
		const serverInfo = asRecord(result?.serverInfo);
		if (typeof serverInfo?.name === "string") this.serverName = serverInfo.name;
		await this.send({ jsonrpc: "2.0", method: "notifications/initialized" }, "initialized-notification");
		this.initialized = true;
	}

	async listTools(): Promise<McpToolDefinition[]> {
		await this.initialize();
		const response = await this.request("tools/list", {}, "list-tools");
		const result = asRecord(response.result);
		return Array.isArray(result?.tools)
			? result.tools.filter(isToolDefinition)
			: [];
	}

	async callTool(name: string, args: Record<string, unknown> = {}, stage = name): Promise<unknown> {
		await this.initialize();
		const response = await this.request("tools/call", { name, arguments: args }, stage);
		const result = asRecord(response.result);
		if (result?.isError === true) {
			throw new PublisherError(extractTextContent(result) || `工具 ${name} 调用失败。`, "REMOTE", stage);
		}
		return result;
	}

	async callToolJson<T>(name: string, args: Record<string, unknown> = {}, stage = name): Promise<T> {
		const result = asRecord(await this.callTool(name, args, stage));
		const text = result ? extractTextContent(result) : "";
		if (!text) {
			assertTencentPayload(result, stage);
			return result as T;
		}
		let parsed: T;
		try {
			parsed = JSON.parse(text) as T;
		} catch {
			if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
				throw new PublisherError("腾讯工具响应包含无效 JSON。", "PROTOCOL", stage);
			}
			return text as T;
		}
		assertTencentPayload(asRecord(parsed), stage);
		return parsed;
	}

	async testConnection(): Promise<ConnectionIdentity> {
		const tools = await this.listTools();
		const identityTool = tools.find((tool) =>
			/(?:^|\.)(?:get|query|current|whoami).*?(?:user|account)|(?:user|account).*?(?:info|current)$/i.test(tool.name),
		);
		if (!identityTool) {
			return {
				accountId: `credential:${await credentialFingerprint(this.token)}`,
				displayName: "Token 已验证",
				serverName: this.serverName,
			};
		}
		const payload = await this.callToolJson<unknown>(identityTool.name, {}, "connection-test");
		const record = unwrapPayload(payload);
		const accountId = firstString(record, ["account_id", "accountId", "user_id", "userId", "openid", "id"]);
		if (!accountId) throw new PublisherError("连接成功，但当前账号信息缺少稳定 ID。", "PROTOCOL", "connection-test");
		return {
			accountId,
			displayName: firstString(record, ["display_name", "displayName", "name", "nickname"]) ?? accountId,
			serverName: this.serverName,
		};
	}

	private async request(method: string, params: unknown, stage: string): Promise<JsonRpcResponse> {
		const id = this.nextId++;
		const response = await this.send({ jsonrpc: "2.0", id, method, params }, stage);
		if (!response || response.id !== id) {
			throw new PublisherError("MCP 响应缺失或请求 ID 不匹配。", "PROTOCOL", stage);
		}
		if (response.error) {
			throw new PublisherError(response.error.message ?? "MCP 返回未知错误。", "REMOTE", stage);
		}
		return response;
	}

	private async send(body: JsonRpcRequest, stage: string): Promise<JsonRpcResponse | null> {
		const headers: Record<string, string> = {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			authorization: this.token,
		};
		if (this.sessionId) headers["mcp-session-id"] = this.sessionId;

		let response: TransportResponse;
		try {
			response = await withTimeout(
				this.transport({ url: TENCENT_MCP_ENDPOINT, headers, body: JSON.stringify(body) }),
				this.timeoutMs,
			);
		} catch (error) {
			if (error instanceof PublisherError) throw error;
			throw new PublisherError("腾讯文档请求未获得明确响应。", "NETWORK", stage, undefined, true);
		}

		const traceId = header(response.headers, "x-trace-id") ?? header(response.headers, "trace-id");
		if (response.status >= 400) throw classifyHttpError(response.status, stage, traceId);
		const returnedSession = header(response.headers, "mcp-session-id");
		if (returnedSession) this.sessionId = returnedSession;
		return parseMcpResponse(response.text, header(response.headers, "content-type") ?? "application/json", body.id);
	}
}

function header(headers: Record<string, string>, name: string): string | undefined {
	const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
	return key ? headers[key] : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function isToolDefinition(value: unknown): value is McpToolDefinition {
	return typeof asRecord(value)?.name === "string";
}

function extractTextContent(result: Record<string, unknown>): string {
	if (!Array.isArray(result.content)) return "";
	return result.content
		.map(asRecord)
		.filter((item): item is Record<string, unknown> => item !== null && item.type === "text")
		.map((item) => (typeof item.text === "string" ? item.text : ""))
		.join("\n");
}

function unwrapPayload(value: unknown): Record<string, unknown> {
	const record = asRecord(value);
	if (!record) return {};
	for (const key of ["data", "user", "account", "result"]) {
		const nested = asRecord(record[key]);
		if (nested) return nested;
	}
	return record;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		if (typeof record[key] === "string" && record[key]) return record[key];
	}
	return undefined;
}

function assertTencentPayload(record: Record<string, unknown> | null, stage: string): void {
	if (!record || !record.error) return;
	const traceId = firstString(record, ["trace_id", "traceId"]);
	const serialized = typeof record.error === "string" ? record.error : JSON.stringify(record.error);
	if (/400006|鉴权|token/i.test(serialized)) throw new PublisherError("Token 鉴权失败。", "AUTH", stage, traceId);
	if (/400007|VIP/i.test(serialized)) throw new PublisherError("当前账号缺少所需的腾讯文档 VIP 权限。", "QUOTA", stage, traceId);
	if (/400008|积分|额度/i.test(serialized)) throw new PublisherError("腾讯文档积分或额度不足。", "QUOTA", stage, traceId);
	if (/429|限流|频率/i.test(serialized)) throw new PublisherError("腾讯接口触发限流。", "RATE_LIMIT", stage, traceId, true);
	throw new PublisherError("腾讯工具返回错误。", "REMOTE", stage, traceId);
}

async function credentialFingerprint(token: string): Promise<string> {
	const bytes = new TextEncoder().encode(token);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest).slice(0, 12), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_resolve, reject) => {
				timer = setTimeout(
					() => reject(new PublisherError("腾讯文档请求超时。", "TIMEOUT", "request", undefined, true)),
					timeoutMs,
				);
			}),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

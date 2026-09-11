import { describe, expect, it } from "vitest";
import { migrateData } from "../domain/publish-state";
import { PublisherError, redact } from "./errors";
import { TencentMcpClient, type McpTransport, type TransportRequest } from "./mcp-client";
import { parseMcpResponse, parseSseData } from "./mcp-protocol";

describe("MCP protocol", () => {
	it("parses multi-line SSE and selects the matching JSON-RPC id", () => {
		const text = [
			"event: message\ndata: {\"jsonrpc\":\"2.0\",\ndata: \"id\":1,\"result\":{}}",
			"event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"ok\":true}}",
		].join("\n\n");
		expect(parseSseData(text)).toHaveLength(2);
		expect(parseMcpResponse(text, "text/event-stream", 2)?.id).toBe(2);
	});

	it("rejects invalid protocol payloads without echoing content", () => {
		expect(() => parseMcpResponse("not-json", "application/json")).toThrow(PublisherError);
	});
});

describe("TencentMcpClient", () => {
	it("initializes, preserves the session id, supports JSON and performs a read-only identity test", async () => {
		const requests: TransportRequest[] = [];
		const responses = [
			json(1, { serverInfo: { name: "Tencent" } }, { "mcp-session-id": "session-1" }),
			empty(),
			json(2, { tools: [{ name: "user.get_user_info" }] }),
			json(3, { content: [{ type: "text", text: '{"user_id":"u-1","nickname":"Tester"}' }] }),
		];
		const transport: McpTransport = async (request) => {
			requests.push(request);
			const response = responses.shift();
			if (!response) throw new Error("unexpected request");
			return response;
		};

		const identity = await new TencentMcpClient("secret", transport).testConnection();
		expect(identity).toEqual({ accountId: "u-1", displayName: "Tester", serverName: "Tencent" });
		expect(requests[1]?.headers["mcp-session-id"]).toBe("session-1");
		expect(requests.every((request) => request.headers.authorization === "secret")).toBe(true);
		const toolListRequest: unknown = JSON.parse(requests[2]?.body ?? "{}");
		expect(toolListRequest).toMatchObject({ method: "tools/list" });
	});

	it("classifies rate limits and never includes the token in the error", async () => {
		const client = new TencentMcpClient("top-secret", async () => ({
			status: 429,
			headers: { "x-trace-id": "trace-1" },
			text: "authorization: Bearer top-secret",
		}));
		await expect(client.initialize()).rejects.toMatchObject({ code: "RATE_LIMIT", traceId: "trace-1" });
	});

	it("times out without replaying the request", async () => {
		let calls = 0;
		const client = new TencentMcpClient("secret", () => {
			calls += 1;
			return new Promise(() => undefined);
		}, 5);
		await expect(client.initialize()).rejects.toMatchObject({ code: "TIMEOUT" });
		expect(calls).toBe(1);
	});

	it("classifies Tencent errors returned inside an HTTP 200 tool payload", async () => {
		const responses = [
			json(1, { serverInfo: { name: "Tencent" } }),
			empty(),
			json(2, { content: [{ type: "text", text: '{"error":"400008 points exhausted","trace_id":"payload-trace"}' }] }),
		];
		const client = new TencentMcpClient("secret", async () => responses.shift()!);
		await expect(client.callToolJson("manage.search_file", { search_key: "x" })).rejects.toMatchObject({
			code: "QUOTA",
			traceId: "payload-trace",
		});
	});

	it("falls back to a non-reversible credential identity if the server exposes no account tool", async () => {
		const responses = [json(1, { serverInfo: { name: "Tencent" } }), empty(), json(2, { tools: [] })];
		const client = new TencentMcpClient("secret", async () => responses.shift()!);
		const identity = await client.testConnection();
		expect(identity.accountId).toMatch(/^credential:[0-9a-f]{24}$/);
		expect(identity.displayName).toBe("Token 已验证");
	});
});

describe("persisted data", () => {
	it("migrates the old scaffold without retaining endpoint or mappings", () => {
		const migrated = migrateData({
			mcpServerUrl: "http://localhost:3000",
			autoSyncOnSave: true,
			mappings: [{ sourcePath: "secret.md" }],
			showRibbonIcon: false,
		});
		expect(migrated.showRibbonIcon).toBe(false);
		expect(migrated.projects).toEqual([]);
		expect(JSON.stringify(migrated)).not.toContain("localhost");
	});

	it("rejects future schema versions", () => {
		expect(() => migrateData({ schemaVersion: 99 })).toThrow("高于插件支持");
	});
});

describe("redaction", () => {
	it("removes tokens, upload URLs and long base64", () => {
		const message = `authorization: Bearer abc token=xyz https://cdn.example/upload/a ${"a".repeat(100)}`;
		const cleaned = redact(message);
		expect(cleaned).not.toContain("abc");
		expect(cleaned).not.toContain("xyz");
		expect(cleaned).not.toContain("cdn.example");
		expect(cleaned).not.toContain("a".repeat(100));
	});
});

function json(id: number, result: unknown, headers: Record<string, string> = {}) {
	return {
		status: 200,
		headers: { "content-type": "application/json", ...headers },
		text: JSON.stringify({ jsonrpc: "2.0", id, result }),
	};
}

function empty() {
	return { status: 202, headers: { "content-type": "application/json" }, text: "" };
}

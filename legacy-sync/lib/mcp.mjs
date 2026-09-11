/**
 * 极简 MCP 客户端 —— 直接对腾讯文档的 MCP 端点发 JSON-RPC 请求。
 * 复用 mcporter 已有的鉴权配置，不额外引入任何依赖。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CONFIG_PATH = path.join(os.homedir(), ".mcporter", "mcporter.json");

export function loadServerConfig(name = "tencent-docs") {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      `未找到 mcporter 配置：${CONFIG_PATH}\n请先按腾讯文档 skill 完成一次授权。`
    );
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const srv = cfg.mcpServers?.[name];
  if (!srv) throw new Error(`mcporter 配置里没有服务：${name}`);
  return srv;
}

function parseSse(text) {
  const out = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .join("");
    if (data) out.push(data);
  }
  return out;
}

export class McpClient {
  constructor(serverName = "tencent-docs") {
    const srv = loadServerConfig(serverName);
    this.url = srv.baseUrl;
    this.headers = { ...(srv.headers || {}) };
    this.sessionId = null;
    this.nextId = 1;
  }

  async #post(body) {
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...this.headers,
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;

    // 连接层偶发超时（尤其在国内网络下）很常见，这类失败请求还没发出去，重试是安全的。
    // 注意只重试「没建立连接」的错误；一旦收到响应就不再重放，避免写操作被应用两次。
    const PRE_SEND = /ConnectTimeout|UND_ERR_CONNECT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ERR_SOCKET|UND_ERR_SOCKET/i;
    let res;
    for (let attempt = 1; ; attempt++) {
      try {
        res = await fetch(this.url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        break;
      } catch (e) {
        const cause = e?.cause?.code || e?.cause?.name || e?.code || "";
        const retriable = PRE_SEND.test(String(cause)) || PRE_SEND.test(String(e?.message || ""));
        if (!retriable || attempt >= 4) throw e;
        await new Promise((r) => setTimeout(r, 900 * attempt));
      }
    }

    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 1500)}`);
    }
    const ctype = res.headers.get("content-type") || "";
    if (ctype.includes("text/event-stream")) {
      const events = parseSse(text);
      if (!events.length) return null;
      return JSON.parse(events[events.length - 1]);
    }
    if (!text.trim()) return null;
    return JSON.parse(text);
  }

  async initialize() {
    const r = await this.#post({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "obsidian-td-sync", version: "1.0.0" },
      },
    });
    await this.#post({ jsonrpc: "2.0", method: "notifications/initialized" });
    return r?.result;
  }

  async call(name, args = {}) {
    if (this.sessionId === null) await this.initialize();
    const r = await this.#post({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "tools/call",
      params: { name, arguments: args },
    });
    if (r?.error) throw new Error(`MCP error ${r.error.code}: ${r.error.message}`);
    const result = r?.result;
    if (result?.isError) {
      const msg = (result.content || []).map((c) => c.text).join("\n");
      throw new Error(`工具 ${name} 调用失败：${msg}`);
    }
    return result;
  }

  /** 调用工具并把返回的文本载荷解析成对象。 */
  async callJson(name, args = {}) {
    const result = await this.call(name, args);
    const joined = (result?.content || [])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    try {
      return JSON.parse(joined);
    } catch {
      return joined;
    }
  }
}

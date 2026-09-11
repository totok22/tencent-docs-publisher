import { describe, expect, it } from "vitest";
import { applyResolvedAssets, convertMarkdownToMdx, validateGeneratedMdx } from "../convert/markdown-to-mdx";
import { parseRemoteMdx } from "../convert/remote-mdx-parser";
import type { PublishProject } from "../types";
import { preflightPage, type PreflightVaultReader } from "./preflight";
import { publishPreparedPage } from "./publish-page";

describe("Markdown conversion", () => {
	it("converts tables, formulas, callouts, highlights, images and PDFs", () => {
		const markdown = `---\ntitle: Hidden\n---\n> [!NOTE] Tip\n> body\n\n| A | B |\n| -- | -- |\n| 1 | 2 |\n\n$$R_{\\text{test}} = \\text{max}$$\n==mark==\n![[img.png|diagram]]\n[spec](doc.pdf)\n%%hidden%%`;
		const conversion = convertMarkdownToMdx(markdown, { resolvePath: (target) => `assets/${target}` });
		expect(conversion.mdx).toContain('<Callout type="note" title="Tip">body</Callout>');
		expect(conversion.mdx).toContain("<Table>");
		expect(conversion.mdx).toContain("<MathBlock>");
		expect(conversion.mdx).toContain("<MathBlock>\n$$\nR_{\\text{test}} = \\text{max}\n$$\n</MathBlock>");
		expect(conversion.mdx).not.toContain("$$$");
		expect(conversion.mdx).toContain('<Mark backgroundColor="yellow">mark</Mark>');
		expect(conversion.mdx).not.toContain("title: Hidden");
		expect(conversion.mdx).not.toContain("hidden");
		expect(conversion.assets.map((asset) => [asset.kind, asset.resolvedPath])).toEqual([
			["image", "assets/img.png"],
			["pdf", "assets/doc.pdf"],
		]);
		const resolved = applyResolvedAssets(conversion, { 0: "https://img", 1: "https://pdf" });
		expect(resolved).toContain('<Image src="https://img" alt="diagram" />');
		expect(resolved).toContain("[spec](https://pdf)");
		expect(validateGeneratedMdx(resolved)).toEqual([]);
	});

	it("escapes prose braces while allowing braces in Markdown math and code", () => {
		const conversion = convertMarkdownToMdx("字面量 {value}\n\n行内 $R_{test}$\n\n`const x = {a: 1}`", {
			resolvePath: () => null,
		});
		expect(conversion.mdx).toContain("字面量 &#123;value&#125;");
		expect(conversion.mdx).toContain("$R_{test}$");
		expect(conversion.mdx).toContain("`const x = {a: 1}`");
		expect(validateGeneratedMdx(conversion.mdx)).toEqual([]);
	});

	it("escapes raw HTML and rejects expressions/unknown components", () => {
		const conversion = convertMarkdownToMdx("<script>alert(1)</script>", { resolvePath: () => null });
		expect(conversion.mdx).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
		expect(conversion.warnings).toHaveLength(1);
		expect(validateGeneratedMdx("<Evil /> {run()}")).toEqual([
			"禁止 MDX 表达式。",
			"未知 MDX 组件：Evil",
		]);
	});

	it("drops empty headings that Tencent would render as placeholder titles", () => {
		const conversion = convertMarkdownToMdx("# 保持\n\n### \n\n正文\n\n```\n###\n```", { resolvePath: () => null });
		expect(conversion.mdx).toContain("# 保持");
		expect(conversion.mdx).toContain("正文");
		expect(conversion.mdx).toContain("```\n###\n```");
		expect(conversion.warnings.some((warning) => warning.includes("空标题"))).toBe(true);
	});

	it("converts block math outside code and reports unpaired delimiters", () => {
		const conversion = convertMarkdownToMdx("$$a+b$$", { resolvePath: () => null });
		expect(conversion.mdx).toBe("<MathBlock>\n$$\na+b\n$$\n</MathBlock>");
		expect(conversion.warnings).toEqual([]);

		const inCode = convertMarkdownToMdx("```\n$$a+b$$\n```", { resolvePath: () => null });
		expect(inCode.mdx).toBe("```\n$$a+b$$\n```");
		expect(inCode.warnings).toEqual([]);

		const unpaired = convertMarkdownToMdx("公式缺失闭合 $$a+b", { resolvePath: () => null });
		expect(unpaired.mdx).toBe("公式缺失闭合 $$a+b");
		expect(unpaired.warnings.some((warning) => warning.includes("没有配对"))).toBe(true);
	});
});

describe("read-only preflight", () => {
	it("quick preview never calls a remote client and hashes referenced asset contents", async () => {
		const reader = fixtureReader("hello ![[a.png]]", { "a.png": new Uint8Array([1, 2, 3]).buffer });
		const project = fixtureProject();
		const result = await preflightPage(reader, project, "index.md", "quick", undefined, {
			projectId: "project", fetchedAt: "2026-01-01T00:00:00.000Z", nodes: {},
		});
		expect(result.status).toBe("changed");
		expect(result.remoteFresh).toBe(false);
		expect(result.assets[0]?.size).toBe(3);
	});

	it("detects remote fingerprint conflicts only after a complete refreshed read", async () => {
		const project = fixtureProject();
		project.pageMap["index.md"]!.lastPublishedRemoteHash = "previous";
		const client = {
			async callToolJson<T>(): Promise<T> {
				return { content: '<Page id="root"><Paragraph id="p">changed</Paragraph></Page>' } as T;
			},
		};
		const result = await preflightPage(fixtureReader("hello"), project, "index.md", "refreshed", client);
		expect(result.status).toBe("conflict");
		expect(result.remoteFresh).toBe(true);
	});

	it("rejects local images larger than 10 MB before any write", async () => {
		const oversized = new Uint8Array(10 * 1024 * 1024 + 1).buffer;
		const result = await preflightPage(
			fixtureReader("![[huge.png]]", { "huge.png": oversized }),
			fixtureProject(),
			"index.md",
			"quick",
		);
		expect(result.status).toBe("error");
		expect(result.errors[0]).toContain("超过 10 MB");
	});

	it("reports a missing remote Page as a node-level preflight error", async () => {
		const client = { async callToolJson<T>(): Promise<T> { throw new Error("Page not found"); } };
		const result = await preflightPage(fixtureReader("hello"), fixtureProject(), "index.md", "refreshed", client);
		expect(result.status).toBe("error");
		expect(result.errors).toEqual(["Page not found"]);
	});

	it("expands embedded Markdown, strips nested frontmatter and protects cycles", async () => {
		const markdownFiles: Record<string, string> = {
			"docs/index.md": "before\n![[child.md]]\nafter",
			"docs/child.md": "---\ntitle: Hidden child title\n---\nchild body\n![[index.md]]",
		};
		const reader: PreflightVaultReader = {
			async readMarkdown(path) { return markdownFiles[path] ?? ""; },
			async readBinary(path) { throw new Error(path); },
			resolvePath(target, sourcePath) {
				const folder = sourcePath.split("/").slice(0, -1).join("/");
				const path = target.includes("/") ? target : `${folder}/${target}`;
				return markdownFiles[path] !== undefined ? path : null;
			},
		};
		const project = fixtureProject();
		project.sourceRootPath = "docs/index.md";
		project.allowedRootPath = "docs";
		project.pageMap["docs/index.md"] = project.pageMap["index.md"]!;
		delete project.pageMap["index.md"];
		const preview = await preflightPage(reader, project, "docs/index.md", "quick", undefined, undefined, false);
		expect(preview.conversion.mdx).toContain("child body");
		expect(preview.conversion.mdx).not.toContain("Hidden child title");
		expect(preview.conversion.mdx).toContain("[内嵌循环：index.md]");
		expect(preview.warnings.some((warning) => warning.includes("循环"))).toBe(true);
	});
});

describe("single page publishing", () => {
	it.each([
		["a page containing only a child Page", '<Page id="child">Child</Page>', ["child"]],
		["a completely empty page", "---\ntitle: Empty\n---\n", []],
	])("appends to the document root without a Page anchor for %s", async (_case, initialRemote, expectedChildren) => {
		const project = fixtureProject();
		let remote = initialRemote;
		const operations: Array<Record<string, unknown>> = [];
		const client = {
			async callToolJson<T>(name: string, args?: Record<string, unknown>): Promise<T> {
				if (name === "smartcanvas.read") return { content: remote } as T;
				operations.push(args ?? {});
				if (args?.action === "INSERT_AFTER" && args.id === undefined) {
					remote += '<Paragraph id="new">new</Paragraph>';
				}
				return {} as T;
			},
		};
		const preflight = await preflightPage(fixtureReader("new"), project, "index.md", "refreshed", client);
		await publishPreparedPage(client, project, preflight, "new");
		expect(operations).toEqual([{ file_id: "file", action: "INSERT_AFTER", content: "new" }]);
		expect(parseRemoteMdx(remote, "root").directChildPages.map((page) => page.pageId)).toEqual(expectedChildren);
	});

	it("writes into a sub page by anchoring on an ordinary block inside that page", async () => {
		const project = fixtureProject();
		let remote = '<Page id="child"><Paragraph id="child-old">old</Paragraph><Page id="grand" title="Grand" /></Page>';
		const operations: Array<Record<string, unknown>> = [];
		const client = {
			async callToolJson<T>(name: string, args?: Record<string, unknown>): Promise<T> {
				if (name === "smartcanvas.read") return { content: remote } as T;
				operations.push(args ?? {});
				if (args?.action === "INSERT_BEFORE" && args.id === "child-old") {
					remote = remote.replace('<Paragraph id="child-old">', '<Paragraph id="new">new</Paragraph><Paragraph id="child-old">');
				}
				if (args?.action === "DELETE" && args.id === "child-old") {
					remote = remote.replace(/<Paragraph id="child-old">[\s\S]*?<\/Paragraph>/, "");
				}
				return {} as T;
			},
		};
		project.pageMap["index.md"] = { pageId: "child", parentPageId: "root", localTitle: "Index", remoteTitle: "Child" };
		const preflight = await preflightPage(fixtureReader("new"), project, "index.md", "refreshed", client);
		const result = await publishPreparedPage(client, project, preflight, "new");
		expect(operations).toEqual([
			{ file_id: "file", action: "INSERT_BEFORE", id: "child-old", content: "new" },
			{ file_id: "file", action: "DELETE", id: "child-old" },
		]);
		expect(remote).toContain('<Page id="grand" title="Grand" />');
		expect(result.deletedBlocks).toBe(1);
	});

	it("refuses an empty sub page instead of letting the write fall through to the document root", async () => {
		const project = fixtureProject();
		const remote = "---\ntitle: Child\n---\n";
		const operations: Array<Record<string, unknown>> = [];
		const client = {
			async callToolJson<T>(name: string, args?: Record<string, unknown>): Promise<T> {
				if (name === "smartcanvas.read") return { content: remote } as T;
				operations.push(args ?? {});
				return {} as T;
			},
		};
		project.pageMap["index.md"] = { pageId: "child", parentPageId: "root", localTitle: "Index", remoteTitle: "Child" };
		const preflight = await preflightPage(fixtureReader("new"), project, "index.md", "refreshed", client);
		expect(preflight.warnings.some((warning) => warning.includes("还没有正文"))).toBe(true);
		await expect(publishPreparedPage(client, project, preflight, "new")).rejects.toMatchObject({
			code: "EMPTY_SUB_PAGE",
		});
		expect(operations).toEqual([]);
	});


	it("keeps content on both sides of a child Page card", async () => {
		const project = fixtureProject();
		const remote = '<Page id="root"><Paragraph id="old-a">old a</Paragraph><Page id="child" title="Child" /><Paragraph id="old-b">old b</Paragraph></Page>';
		const operations: Array<Record<string, unknown>> = [];
		const client = {
			async callToolJson<T>(name: string, args?: Record<string, unknown>): Promise<T> {
				if (name === "smartcanvas.read") return { content: remote } as T;
				operations.push(args ?? {});
				return {} as T;
			},
		};
		const reader: PreflightVaultReader = {
			async readMarkdown() { return "前一段正文\n\n[[child.md]]\n\n后一段正文"; },
			async readBinary(path) { throw new Error(path); },
			resolvePath(target) { return target === "child.md" ? "child.md" : null; },
		};
		project.pageMap["child.md"] = { pageId: "child", parentPageId: "root", localTitle: "Child", remoteTitle: "Child" };
		const preflight = await preflightPage(reader, project, "index.md", "refreshed", client);
		const result = await publishPreparedPage(client, project, preflight, preflight.conversion.mdx);
		expect(operations).toEqual([
			{ file_id: "file", action: "INSERT_BEFORE", id: "old-a", content: "前一段正文" },
			{ file_id: "file", action: "INSERT_BEFORE", id: "old-b", content: "后一段正文" },
			{ file_id: "file", action: "DELETE", id: "old-a" },
			{ file_id: "file", action: "DELETE", id: "old-b" },
		]);
		expect(result.warnings).toEqual([]);
	});

	it("reports adjacent child Page cards instead of silently placing content past them", async () => {
		const project = fixtureProject();
		const remote = '<Page id="root"><Page id="child" title="Child" /><Page id="other" title="Other" /><Paragraph id="old">old</Paragraph></Page>';
		const operations: Array<Record<string, unknown>> = [];
		const client = {
			async callToolJson<T>(name: string, args?: Record<string, unknown>): Promise<T> {
				if (name === "smartcanvas.read") return { content: remote } as T;
				operations.push(args ?? {});
				return {} as T;
			},
		};
		const reader: PreflightVaultReader = {
			async readMarkdown() { return "[[child.md]]\n\n中间的正文\n\n[[other.md]]\n\n结尾正文"; },
			async readBinary(path) { throw new Error(path); },
			resolvePath(target) { return target.endsWith(".md") ? target : null; },
		};
		project.pageMap["child.md"] = { pageId: "child", parentPageId: "root", localTitle: "Child", remoteTitle: "Child" };
		project.pageMap["other.md"] = { pageId: "other", parentPageId: "root", localTitle: "Other", remoteTitle: "Other" };
		const preflight = await preflightPage(reader, project, "index.md", "refreshed", client);
		const result = await publishPreparedPage(client, project, preflight, preflight.conversion.mdx);
		expect(operations).toEqual([
			{ file_id: "file", action: "INSERT_BEFORE", id: "old", content: "中间的正文" },
			{ file_id: "file", action: "INSERT_BEFORE", id: "old", content: "结尾正文" },
			{ file_id: "file", action: "DELETE", id: "old" },
		]);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain("连在一起");
		expect(result.warnings[0]).toContain("拖到正文该在的位置");
	});


	it("keeps an inline mention of a child page as plain text", async () => {
		const project = fixtureProject();
		const remote = '<Page id="root"><Paragraph id="old">old</Paragraph></Page>';
		const operations: Array<Record<string, unknown>> = [];
		const client = {
			async callToolJson<T>(name: string, args?: Record<string, unknown>): Promise<T> {
				if (name === "smartcanvas.read") return { content: remote } as T;
				operations.push(args ?? {});
				return {} as T;
			},
		};
		const reader: PreflightVaultReader = {
			async readMarkdown() { return "详见 [[child.md|子页面说明]] 与 [[child.md]]\n\n| 列 | 值 |\n| -- | -- |\n| 参考 | [[child.md]] |"; },
			async readBinary(path) { throw new Error(path); },
			resolvePath(target) { return target === "child.md" ? "child.md" : null; },
		};
		project.pageMap["child.md"] = { pageId: "child", parentPageId: "root", localTitle: "Child", remoteTitle: "Child" };
		const preflight = await preflightPage(reader, project, "index.md", "refreshed", client);
		const result = await publishPreparedPage(client, project, preflight, preflight.conversion.mdx);
		expect(result.warnings).toEqual([]);
		expect(operations).toHaveLength(2);
		const inserted = operations[0]?.["content"] as string;
		expect(inserted).not.toContain("\u0000");
		expect(inserted).toContain("子页面说明");
		expect(inserted).toContain("child");
		expect(inserted).toContain("<Table>");
		expect(operations[1]).toEqual({ file_id: "file", action: "DELETE", id: "old" });
	});

	it("deletes only ordinary blocks and verifies that child Page order is retained", async () => {
		const project = fixtureProject();
		let remote = '<Page id="root"><Paragraph id="old">old</Paragraph><Page id="child" title="Child" /><Readonly id="locked" readonly="true">keep</Readonly><Custom id="unknown">keep</Custom></Page>';
		const operations: Array<Record<string, unknown>> = [];
		const client = {
			async callToolJson<T>(name: string, args?: Record<string, unknown>): Promise<T> {
				if (name === "smartcanvas.read") return { content: remote } as T;
				operations.push(args ?? {});
				if (args?.action === "INSERT_BEFORE") remote = remote.replace('<Paragraph id="old">', '<Paragraph id="new">new</Paragraph><Paragraph id="old">');
				if (args?.action === "DELETE") remote = remote.replace(/<Paragraph id="old">[\s\S]*?<\/Paragraph>/, "");
				return {} as T;
			},
		};
		const preflight = await preflightPage(fixtureReader("new"), project, "index.md", "refreshed", client);
		const result = await publishPreparedPage(client, project, preflight, "new");
		expect(operations).toEqual([
			{ file_id: "file", action: "INSERT_BEFORE", id: "old", content: "new" },
			{ file_id: "file", action: "DELETE", id: "old" },
		]);
		const parsed = parseRemoteMdx(remote, "root");
		expect(parsed.directChildPages.map((page) => page.pageId)).toEqual(["child"]);
		expect(parsed.blocks.find((block) => block.id === "locked")?.reason).toBe("readonly");
		expect(parsed.blocks.find((block) => block.id === "unknown")?.reason).toBe("unsupported");
		expect(result.deletedBlocks).toBe(1);
		expect(project.pageMap["index.md"]?.lastPublishedSourceHash).toBe(preflight.sourceHash);
	});

	it("restores the ordinary-content snapshot after a mid-write failure", async () => {
		const project = fixtureProject();
		let remote = '<Page id="root"><Paragraph id="old">old</Paragraph><Page id="child" title="Child" /></Page>';
		let failedOnce = false;
		const client = {
			async callToolJson<T>(name: string, args?: Record<string, unknown>, stage?: string): Promise<T> {
				if (name === "smartcanvas.read") return { content: remote } as T;
				if (stage === "delete-old-block" && !failedOnce) {
					failedOnce = true;
					throw new Error("injected failure");
				}
				if (args?.action === "INSERT_BEFORE") {
					const id = String(args.id);
					const inserted = stage === "restore-insert"
						? '<Paragraph id="restored">old</Paragraph>'
						: '<Paragraph id="new">new</Paragraph>';
					remote = remote.replace(`<Paragraph id="${id}">`, `${inserted}<Paragraph id="${id}">`);
				}
				if (args?.action === "DELETE") {
					const id = String(args.id);
					remote = remote.replace(new RegExp(`<Paragraph id="${id}">[\\s\\S]*?<\\/Paragraph>`), "");
				}
				return {} as T;
			},
		};
		const preflight = await preflightPage(fixtureReader("new"), project, "index.md", "refreshed", client);
		await expect(publishPreparedPage(client, project, preflight, "new")).rejects.toThrow("injected failure");
		expect(remote).toContain('<Paragraph id="restored">old</Paragraph>');
		expect(remote).not.toContain('id="new"');
		expect(remote).toContain('id="child"');
		expect(project.pageMap["index.md"]?.lastPublishedSourceHash).toBeUndefined();
	});

	it("does not replay an ambiguous insert when a read proves it was applied", async () => {
		const project = fixtureProject();
		let remote = '<Page id="root"><Paragraph id="old">old</Paragraph><Page id="child" title="Child" /></Page>';
		let insertCalls = 0;
		const client = {
			async callToolJson<T>(name: string, args?: Record<string, unknown>, stage?: string): Promise<T> {
				if (name === "smartcanvas.read") return { content: remote } as T;
				if (stage === "insert-page-content") {
					insertCalls += 1;
					remote = remote.replace('<Paragraph id="old">', '<Paragraph id="new">new</Paragraph><Paragraph id="old">');
					throw new Error("response lost");
				}
				if (args?.action === "DELETE") remote = remote.replace(/<Paragraph id="old">[\s\S]*?<\/Paragraph>/, "");
				return {} as T;
			},
		};
		const preflight = await preflightPage(fixtureReader("new"), project, "index.md", "refreshed", client);
		await publishPreparedPage(client, project, preflight, "new");
		expect(insertCalls).toBe(1);
		expect(remote).toContain('id="new"');
	});

	it("reports remote state unknown when post-write verification loses a child Page", async () => {
		const project = fixtureProject();
		let remote = '<Page id="root"><Paragraph id="old">old</Paragraph><Page id="child" title="Child" /></Page>';
		const client = {
			async callToolJson<T>(name: string, args?: Record<string, unknown>): Promise<T> {
				if (name === "smartcanvas.read") return { content: remote } as T;
				if (args?.action === "INSERT_BEFORE") {
					remote = remote.replace('<Paragraph id="old">', '<Paragraph id="new">new</Paragraph><Paragraph id="old">').replace(/<Page id="child"[^>]*\/>/, "");
				}
				if (args?.action === "DELETE") {
					const id = String(args.id);
					remote = remote.replace(new RegExp(`<Paragraph id="${id}">[\\s\\S]*?<\\/Paragraph>`), "");
				}
				return {} as T;
			},
		};
		const preflight = await preflightPage(fixtureReader("new"), project, "index.md", "refreshed", client);
		await expect(publishPreparedPage(client, project, preflight, "new")).rejects.toMatchObject({
			code: "AMBIGUOUS_WRITE",
			stage: "restore-page",
		});
	});
});

function fixtureReader(markdown: string, binaries: Record<string, ArrayBuffer> = {}): PreflightVaultReader {
	return {
		async readMarkdown() { return markdown; },
		async readBinary(path) { const value = binaries[path]; if (!value) throw new Error(path); return value; },
		resolvePath(target) { return Object.prototype.hasOwnProperty.call(binaries, target) ? target : null; },
	};
}

function fixtureProject(): PublishProject {
	return {
		schemaVersion: 1,
		id: "project",
		accountId: "account",
		sourceRootPath: "index.md",
		allowedRootPath: "",
		remoteFileId: "file",
		remoteUrl: "https://docs.qq.com/doc",
		remoteRootPageId: "root",
		publicRead: false,
		maxDepth: 8,
		maxNotes: 200,
		pageMap: {
			"index.md": { pageId: "root", parentPageId: null, localTitle: "Index", remoteTitle: "Root" },
		},
	};
}

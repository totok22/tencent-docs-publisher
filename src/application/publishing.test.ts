import { describe, expect, it } from "vitest";
import { applyResolvedAssets, convertMarkdownToMdx, validateGeneratedMdx } from "../convert/markdown-to-mdx";
import { parseRemoteMdx } from "../convert/remote-mdx-parser";
import type { PublishProject } from "../types";
import { preflightPage, type PreflightVaultReader } from "./preflight";
import { publishPreparedPage } from "./publish-page";

describe("Markdown conversion", () => {
	it("converts tables, formulas, callouts, highlights, images and PDFs", () => {
		const markdown = `---\ntitle: Hidden\n---\n> [!NOTE] Tip\n> body\n\n| A | B |\n| -- | -- |\n| 1 | 2 |\n\n$$x^2$$\n==mark==\n![[img.png|diagram]]\n[spec](doc.pdf)\n%%hidden%%`;
		const conversion = convertMarkdownToMdx(markdown, { resolvePath: (target) => `assets/${target}` });
		expect(conversion.mdx).toContain('<Callout type="note" title="Tip">body</Callout>');
		expect(conversion.mdx).toContain("<Table>");
		expect(conversion.mdx).toContain("<MathBlock>x^2</MathBlock>");
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

	it("escapes raw HTML and rejects expressions/unknown components", () => {
		const conversion = convertMarkdownToMdx("<script>alert(1)</script>", { resolvePath: () => null });
		expect(conversion.mdx).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
		expect(conversion.warnings).toHaveLength(1);
		expect(validateGeneratedMdx("<Evil /> {run()}")).toEqual([
			"禁止 MDX 表达式。",
			"未知 MDX 组件：Evil",
		]);
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

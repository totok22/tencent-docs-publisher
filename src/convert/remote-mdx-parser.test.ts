import { describe, expect, it } from "vitest";
import { parseRemoteMdx, remoteContentFingerprint } from "./remote-mdx-parser";
import { readCompletePage } from "../tencent/smartcanvas";

const CONTENT = `<Page id="root" title="Root">
<Paragraph id="p1">正文</Paragraph>
<Page id="child-a" title="子页 A">
  <Paragraph id="p2">子页内容</Paragraph>
  <Page id="grandchild" title="孙页" />
</Page>
<Paragraph id="locked" readonly="true">人工块</Paragraph>
<CustomWidget id="custom">未知组件</CustomWidget>
</Page>`;

describe("remote MDX parser", () => {
	it("extracts only direct page children while retaining nested pages", () => {
		const parsed = parseRemoteMdx(CONTENT, "root");
		expect(parsed.directChildPages.map((page) => page.pageId)).toEqual(["child-a"]);
		expect(parsed.allPageElements.map((page) => page.attributes.id)).toEqual([
			"root",
			"child-a",
			"grandchild",
		]);
	});

	it("uses direct Page text as the title in deployed Tencent responses", () => {
		const parsed = parseRemoteMdx(`<Page id="root">
<Page id="child-1">
  测试1
</Page>
<Page id="child-2">测试2</Page>
</Page>`, "root");
		expect(parsed.directChildPages.map(({ pageId, title }) => ({ pageId, title }))).toEqual([
			{ pageId: "child-1", title: "测试1" },
			{ pageId: "child-2", title: "测试2" },
		]);
	});

	it("keeps a sole deployed child Page when the response omits the current-page wrapper", () => {
		const parsed = parseRemoteMdx(`---
title: 测试1
---

<Page id="child-2">
  测试2
</Page>`, "parent-1");
		expect(parsed.pageId).toBe("parent-1");
		expect(parsed.directChildPages).toEqual([{
			pageId: "child-2",
			title: "测试2",
			raw: '<Page id="child-2">\n  测试2\n</Page>',
		}]);
	});

	it("does not mistake nested block content for a Page title", () => {
		const parsed = parseRemoteMdx(`<Page id="root">
<Page id="child"><Paragraph id="p">正文，不是标题</Paragraph></Page>
</Page>`, "root");
		expect(parsed.directChildPages[0]?.title).toBe("未命名页面");
	});

	it("marks Page, readonly and unsupported blocks for preservation", () => {
		const parsed = parseRemoteMdx(CONTENT, "root");
		expect(parsed.blocks.map((block) => [block.id, block.reason])).toEqual([
			["p1", null],
			["child-a", "page"],
			["locked", "readonly"],
			["custom", "unsupported"],
		]);
	});

	it("fingerprint ignores child-page display content but retains its Page ID", async () => {
		const changedChild = CONTENT.replace("子页 A", "重命名显示").replace("子页内容", "完全不同");
		expect(await remoteContentFingerprint(changedChild, "root")).toBe(
			await remoteContentFingerprint(CONTENT, "root"),
		);
		const changedId = CONTENT.replace("child-a", "child-b");
		expect(await remoteContentFingerprint(changedId, "root")).not.toBe(
			await remoteContentFingerprint(CONTENT, "root"),
		);
	});

	it("normalizes line endings and non-semantic trailing whitespace", async () => {
		const withWhitespace = CONTENT.replace(/\n/g, "\r\n").replace("正文", "正文   ");
		expect(await remoteContentFingerprint(withWhitespace, "root")).toBe(
			await remoteContentFingerprint(CONTENT, "root"),
		);
	});

	it("ignores volatile ordinary Block IDs", async () => {
		const changedIds = CONTENT.replace('id="p1"', 'id="server-generated-new"');
		expect(await remoteContentFingerprint(changedIds, "root")).toBe(
			await remoteContentFingerprint(CONTENT, "root"),
		);
	});
});

describe("complete page reads", () => {
	it("reads all pages with size 20 and forwards page_id and next_token", async () => {
		const calls: Record<string, unknown>[] = [];
		const responses = [
			{ content: "first", next_token: "n1", page_id: "page-1" },
			{ content: "second", next_token: "n2" },
			{ content: "third" },
		];
		const client = {
			async callToolJson<T>(_name: string, args?: Record<string, unknown>): Promise<T> {
				calls.push(args ?? {});
				return responses.shift() as T;
			},
		};
		const result = await readCompletePage(client, "file-1", "page-1");
		expect(result).toEqual({ content: "first\nsecond\nthird", pageCount: 3, pageId: "page-1" });
		expect(calls).toEqual([
			{ file_id: "file-1", page_id: "page-1", size: 20 },
			{ file_id: "file-1", page_id: "page-1", size: 20, next_token: "n1" },
			{ file_id: "file-1", page_id: "page-1", size: 20, next_token: "n2" },
		]);
	});

	it("stops repeated cursors", async () => {
		const client = {
			async callToolJson<T>(): Promise<T> {
				return { content: "x", next_token: "same" } as T;
			},
		};
		await expect(readCompletePage(client, "file")).rejects.toThrow("分页游标重复");
	});

	it("reads more than 20 blocks without truncation", async () => {
		const blocks = Array.from({ length: 45 }, (_, index) => `<Paragraph id="p${index}">${index}</Paragraph>`);
		const pages = [blocks.slice(0, 20), blocks.slice(20, 40), blocks.slice(40)];
		let index = 0;
		const client = {
			async callToolJson<T>(): Promise<T> {
				const page = pages[index] ?? [];
				index += 1;
				return {
					content: page.join("\n"),
					...(index < pages.length ? { next_token: `n${index}` } : {}),
				} as T;
			},
		};
		const result = await readCompletePage(client, "file");
		expect(parseRemoteMdx(result.content).blocks).toHaveLength(45);
	});
});

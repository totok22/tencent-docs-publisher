import { describe, expect, it } from "vitest";
import { parseRemoteMdx, remoteContentFingerprint } from "../convert/remote-mdx-parser";
import type { LocalPageNode, LocalTreeResult } from "../domain/local-page-tree";
import { PublishAssetResolver } from "../tencent/assets";
import { requestPublicRead } from "../tencent/permissions";
import { DEFAULT_DATA, type PublishProject } from "../types";
import type { PagePreflight, PreparedAsset, PreflightVaultReader } from "./preflight";
import { executeProjectPublish, type ProjectPreflight } from "./publish-project";

describe("asset publishing", () => {
	it("deduplicates images by SHA-256 during one publish run", async () => {
		let uploads = 0;
		const client = {
			async callToolJson<T>(name: string): Promise<T> {
				if (name === "upload_image") uploads += 1;
				return { image_id: "image-1" } as T;
			},
		};
		const reader = binaryReader({ "a.png": bytes(1, 2), "copy.png": bytes(1, 2) });
		const resolver = new PublishAssetResolver(client, reader, {}, async () => undefined);
		const result = await resolver.resolve([
			asset(0, "image", "a.png", "same-hash"),
			asset(1, "image", "copy.png", "same-hash"),
		]);
		expect(uploads).toBe(1);
		expect(result.urls).toEqual({ 0: "image-1", 1: "image-1" });
	});

	it("reuses unchanged PDFs and records changed imports as orphan diagnostics", async () => {
		const states = {
			"file.pdf": { sourcePath: "file.pdf", contentHash: "old-hash", fileId: "old-id", fileUrl: "https://old", orphanedFileIds: [] },
		};
		let uploads = 0;
		const calls: string[] = [];
		const client = {
			async callToolJson<T>(name: string): Promise<T> {
				calls.push(name);
				if (name === "manage.pre_import") return { upload_url: "https://upload", task_id: "task", file_key: "key" } as T;
				if (name === "manage.async_import") return { task_id: "task" } as T;
				return { file_url: "https://new", file_id: "new-id" } as T;
			},
		};
		const resolver = new PublishAssetResolver(
			client,
			binaryReader({ "file.pdf": bytes(1, 2, 3) }),
			states,
			async () => { uploads += 1; },
			async () => undefined,
		);
		const result = await resolver.resolve([asset(0, "pdf", "file.pdf", "new-hash")]);
		expect(uploads).toBe(1);
		expect(calls).toEqual(["manage.pre_import", "manage.async_import", "manage.import_progress"]);
		expect(result.urls[0]).toBe("https://new");
		expect(states["file.pdf"].orphanedFileIds).toEqual(["old-id"]);
	});
});

describe("permissions", () => {
	it("requests policy 2 once per document and reports failures without claiming verification", async () => {
		const calls: Record<string, unknown>[] = [];
		const client = {
			async callToolJson<T>(_name: string, args?: Record<string, unknown>): Promise<T> {
				calls.push(args ?? {});
				if (args?.file_id === "pdf") throw new Error("denied");
				return {} as T;
			},
		};
		const result = await requestPublicRead(client, ["doc", "pdf", "doc"]);
		expect(calls).toEqual([{ file_id: "doc", policy: 2 }, { file_id: "pdf", policy: 2 }]);
		expect(result).toEqual([
			{ fileId: "doc", requested: true },
			{ fileId: "pdf", requested: false, error: "denied" },
		]);
	});
});

describe("project publishing", () => {
	it("publishes deepest children first and root last", async () => {
		const fixture = await projectFixture();
		const result = await executeProjectPublish(
			fixture.preflight,
			binaryReader({}),
			fixture.client,
			fixture.data,
			async () => undefined,
		);
		expect(fixture.insertOrder).toEqual(["grand-old", "child-old", "root-old"]);
		expect(result.published).toEqual(["grand.md", "child.md", "root.md"]);
	});

	it("cancels only between pages and retains completed-page state", async () => {
		const fixture = await projectFixture();
		const controller = new AbortController();
		const result = await executeProjectPublish(
			fixture.preflight,
			binaryReader({}),
			fixture.client,
			fixture.data,
			async () => undefined,
			{
				signal: controller.signal,
				onProgress: (progress) => {
					if (progress.stage === "verify" && progress.completed === 1) controller.abort();
				},
			},
		);
		expect(result.cancelled).toBe(true);
		expect(result.published).toEqual(["grand.md"]);
		expect(result.skipped.sort()).toEqual(["child.md", "root.md"]);
	});

	it("skips sub pages that have no anchor block and keeps publishing the rest", async () => {
		const fixture = await projectFixture();
		const pageIdByPath: Record<string, string> = { "root.md": "root", "child.md": "child", "grand.md": "grand" };
		fixture.contents.grand = '---\ntitle: Grand\n---\n';
		for (const page of fixture.preflight.pages) {
			const pageId = pageIdByPath[page.localPath] ?? "";
			page.remoteContent = fixture.contents[pageId] ?? "";
			page.parsedRemote = parseRemoteMdx(page.remoteContent, pageId);
		}
		const result = await executeProjectPublish(
			fixture.preflight,
			binaryReader({}),
			fixture.client,
			fixture.data,
			async () => undefined,
		);
		expect(result.published).toEqual(["child.md", "root.md"]);
		expect(result.skipped).toEqual(["grand.md"]);
		expect(Object.values(result.skipReasons)[0]).toContain("还没有正文");
		expect(fixture.insertOrder).toEqual(["child-old", "root-old"]);
	});
});

async function projectFixture() {
	const project = projectValue();
	const root = treeNode("root.md", 0, [treeNode("child.md", 1, [treeNode("grand.md", 2)])]);
	const localTree: LocalTreeResult = { root, byPath: {}, diagnostics: [], truncated: false };
	const contents: Record<string, string> = {
		root: '<Page id="root"><Paragraph id="root-old">old</Paragraph><Page id="child" title="Child" /></Page>',
		child: '<Page id="child"><Paragraph id="child-old">old</Paragraph><Page id="grand" title="Grand" /></Page>',
		grand: '<Page id="grand"><Paragraph id="grand-old">old</Paragraph></Page>',
	};
	const pages: PagePreflight[] = [];
	for (const [path, pageId] of [["root.md", "root"], ["child.md", "child"], ["grand.md", "grand"]] as const) {
		const content = contents[pageId]!;
		pages.push({
			localPath: path, status: "changed", sourceHash: `${pageId}-source`,
			remoteHash: await remoteContentFingerprint(content, pageId), remoteFresh: true, cacheFetchedAt: null,
			conversion: { mdx: "new", assets: [], pageLinks: [], warnings: [] }, assets: [], warnings: [], errors: [],
			remoteContent: content, parsedRemote: parseRemoteMdx(content, pageId),
		});
	}
	const insertOrder: string[] = [];
	const client = {
		async callToolJson<T>(name: string, args?: Record<string, unknown>): Promise<T> {
			if (name === "smartcanvas.read") return { content: contents[String(args?.page_id)] } as T;
			const id = String(args?.id);
			const pageId = id.split("-")[0]!;
			if (args?.action === "INSERT_BEFORE") {
				insertOrder.push(id);
				contents[pageId] = contents[pageId]!.replace(`<Paragraph id="${id}">`, `<Paragraph id="${pageId}-new">new</Paragraph><Paragraph id="${id}">`);
			}
			if (args?.action === "DELETE") contents[pageId] = contents[pageId]!.replace(new RegExp(`<Paragraph id="${id}">[\\s\\S]*?<\\/Paragraph>`), "");
			return {} as T;
		},
	};
	const preflight: ProjectPreflight = {
		project, localTree, pages, blockers: [],
		budget: { pageReadsAtLeast: 6, pageWritesAtLeast: 3, uniqueImages: 0, changedPdfs: 0 },
	};
	return { project, preflight, client, insertOrder, contents, data: structuredClone(DEFAULT_DATA) };
}

function projectValue(): PublishProject {
	return {
		schemaVersion: 1, id: "project", accountId: "account", sourceRootPath: "root.md", allowedRootPath: "",
		remoteFileId: "file", remoteUrl: "https://docs.qq.com/doc", remoteRootPageId: "root", publicRead: false,
		maxDepth: 8, maxNotes: 200,
		pageMap: {
			"root.md": { pageId: "root", parentPageId: null, localTitle: "Root", remoteTitle: "Root" },
			"child.md": { pageId: "child", parentPageId: "root", localTitle: "Child", remoteTitle: "Child" },
			"grand.md": { pageId: "grand", parentPageId: "child", localTitle: "Grand", remoteTitle: "Grand" },
		},
	};
}

function treeNode(path: string, depth: number, children: LocalPageNode[] = []): LocalPageNode {
	return { path, title: path.replace(".md", ""), aliases: [], depth, children };
}

function binaryReader(files: Record<string, ArrayBuffer>): PreflightVaultReader {
	return {
		async readMarkdown() { return ""; },
		async readBinary(path) { const value = files[path]; if (!value) throw new Error(path); return value; },
		resolvePath(target) { return files[target] ? target : null; },
	};
}

function bytes(...values: number[]): ArrayBuffer {
	return new Uint8Array(values).buffer;
}

function asset(index: number, kind: PreparedAsset["kind"], path: string, contentHash: string): PreparedAsset {
	return { index, kind, target: path, resolvedPath: path, label: path, contentHash, size: 3 };
}

import { describe, expect, it } from "vitest";
import {
	discoverLocalPageTree,
	type LocalLink,
	type LocalPageMetadata,
	type LocalPageRepository,
} from "./local-page-tree";
import { discoverRemotePageTree, resolveRemoteDocumentRoot } from "./remote-page-tree";

describe("local page tree", () => {
	it("keeps source order, detects cycles/multiple parents, and rejects subpaths/out-of-scope links", async () => {
		const repository = fixtureRepository({
			"docs/index.md": page("docs/index.md", [
				link("docs/b.md", 20),
				link("docs/a.md", 10),
				link("other/out.md", 30),
				link("docs/section.md", 40, { hasSubpath: true }),
				link(null, 50, { rawTarget: "missing" }),
			]),
			"docs/a.md": page("docs/a.md", [link("docs/shared.md", 1), link("docs/index.md", 2)]),
			"docs/b.md": page("docs/b.md", [link("docs/shared.md", 1)]),
			"docs/shared.md": page("docs/shared.md"),
		});
		const result = await discoverLocalPageTree(repository, "docs/index.md", {
			allowedRootPath: "docs",
			maxDepth: 8,
			maxNotes: 200,
			embeddedMarkdownAsPage: false,
		});
		expect(result.root.children.map((node) => node.path)).toEqual(["docs/a.md", "docs/b.md"]);
		expect(result.byPath["docs/a.md"]?.children[0]?.path).toBe("docs/shared.md");
		expect(result.byPath["docs/b.md"]?.children).toEqual([]);
		expect(result.diagnostics.map((diagnostic) => diagnostic.kind).sort()).toEqual([
			"cycle",
			"multiple-parent",
			"out-of-scope",
			"unresolved",
		]);
	});

	it("honors embed policy and reports limits instead of silently truncating", async () => {
		const repository = fixtureRepository({
			"docs/index.md": page("docs/index.md", [link("docs/a.md", 1, { isEmbed: true })]),
			"docs/a.md": page("docs/a.md", [link("docs/b.md", 1)]),
			"docs/b.md": page("docs/b.md"),
		});
		const ignored = await discoverLocalPageTree(repository, "docs/index.md", {
			allowedRootPath: "docs", maxDepth: 8, maxNotes: 200, embeddedMarkdownAsPage: false,
		});
		expect(ignored.root.children).toEqual([]);
		const limited = await discoverLocalPageTree(repository, "docs/index.md", {
			allowedRootPath: "docs", maxDepth: 1, maxNotes: 200, embeddedMarkdownAsPage: true,
		});
		expect(limited.truncated).toBe(true);
		expect(limited.diagnostics[0]?.kind).toBe("max-depth");
	});

	it("uses full vault-relative paths as identity even for duplicate filenames", async () => {
		const repository = fixtureRepository({
			"docs/index.md": page("docs/index.md", [link("docs/one/readme.md", 1), link("docs/two/readme.md", 2)]),
			"docs/one/readme.md": page("docs/one/readme.md"),
			"docs/two/readme.md": page("docs/two/readme.md"),
		});
		const result = await discoverLocalPageTree(repository, "docs/index.md", {
			allowedRootPath: "docs", maxDepth: 8, maxNotes: 200, embeddedMarkdownAsPage: false,
		});
		expect(Object.keys(result.byPath)).toHaveLength(3);
	});
});

describe("remote page tree", () => {
	it("discovers two levels using complete reads and does not trust top-level children", async () => {
		const content: Record<string, string> = {
			root: '<Page id="root"><Page id="a" title="A"><Page id="wrong" title="nested" /></Page><Page id="b" title="B" /></Page>',
			a: '<Page id="a"><Page id="a1" title="A1" /></Page>',
			b: '<Page id="b"><Paragraph id="p">B</Paragraph></Page>',
			a1: '<Page id="a1"><Paragraph id="q">A1</Paragraph></Page>',
		};
		const client = {
			async callToolJson<T>(name: string, args?: Record<string, unknown>): Promise<T> {
				if (name !== "smartcanvas.read") throw new Error(name);
				return { content: content[String(args?.page_id)] } as T;
			},
		};
		const result = await discoverRemotePageTree(client, "file", "root", "Root");
		expect(result.nodes.root?.childPageIds).toEqual(["a", "b"]);
		expect(result.nodes.a?.childPageIds).toEqual(["a1"]);
		expect(Object.keys(result.nodes).sort()).toEqual(["a", "a1", "b", "root"]);
	});

	it("resolves root Page ID and title while ignoring mixed children arrays", async () => {
		const client = {
			async callToolJson<T>(name: string): Promise<T> {
				return (name === "smartcanvas.get_top_level_pages"
					? { root_page_id: "root", children: ["block", "maybe-page"] }
					: { title: "Document", url: "https://docs.qq.com/doc" }) as T;
			},
		};
		expect(await resolveRemoteDocumentRoot(client, "file")).toEqual({
			pageId: "root", title: "Document", remoteUrl: "https://docs.qq.com/doc",
		});
	});

	it("supports the documented pages[] root response", async () => {
		const client = {
			async callToolJson<T>(name: string): Promise<T> {
				return (name === "smartcanvas.get_top_level_pages"
					? { pages: [{ page_id: "page-array-root", title: "Page title" }] }
					: { type: "smartcanvas", url: "https://docs.qq.com/doc" }) as T;
			},
		};
		expect(await resolveRemoteDocumentRoot(client, "file")).toEqual({
			pageId: "page-array-root", title: "Page title", remoteUrl: "https://docs.qq.com/doc",
		});
	});
});

function fixtureRepository(pages: Record<string, LocalPageMetadata>): LocalPageRepository {
	return {
		async readPage(path: string): Promise<LocalPageMetadata> {
			const value = pages[path];
			if (!value) throw new Error(path);
			return value;
		},
	};
}

function page(path: string, links: LocalLink[] = []): LocalPageMetadata {
	const filename = path.split("/").pop() ?? path;
	return { path, title: filename.replace(/\.md$/, ""), aliases: [], links };
}

function link(
	resolvedPath: string | null,
	position: number,
	overrides: Partial<LocalLink> = {},
): LocalLink {
	return {
		rawTarget: resolvedPath ?? "missing",
		displayText: resolvedPath ?? "missing",
		resolvedPath,
		isEmbed: false,
		hasSubpath: false,
		position,
		...overrides,
	};
}

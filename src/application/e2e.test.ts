import { describe, expect, it } from "vitest";
import type { LocalLink, LocalPageMetadata, LocalPageRepository } from "../domain/local-page-tree";
import { DEFAULT_DATA, type PublishProject } from "../types";
import type { PreflightVaultReader } from "./preflight";
import { executeProjectPublish, prepareProjectPreflight } from "./publish-project";

describe("mocked end-to-end publish", () => {
	it("publishes a two-level tree with a >20-block root and preserves an extra unbound remote Page", async () => {
		const localPages: Record<string, LocalPageMetadata> = {
			"docs/root.md": local("docs/root.md", "Root", [link("docs/child.md", 1)]),
			"docs/child.md": local("docs/child.md", "Child", [link("docs/grand.md", 1)]),
			"docs/grand.md": local("docs/grand.md", "Grand"),
		};
		const repository: LocalPageRepository = {
			async readPage(path) { const page = localPages[path]; if (!page) throw new Error(path); return page; },
		};
		const reader: PreflightVaultReader = {
			async readMarkdown(path) { return `content for ${path}`; },
			async readBinary(path) { throw new Error(path); },
			resolvePath() { return null; },
		};
		const rootBlocks = Array.from({ length: 25 }, (_, index) => `<Paragraph id="root-old-${index}">old ${index}</Paragraph>`).join("");
		const remote: Record<string, string> = {
			root: `<Page id="root">${rootBlocks}<Page id="child" title="Child" /><Page id="extra" title="Remote only" /></Page>`,
			child: '<Page id="child"><Paragraph id="child-old">old</Paragraph><Page id="grand" title="Grand" /></Page>',
			grand: '<Page id="grand"><Paragraph id="grand-old">old</Paragraph></Page>',
			extra: '<Page id="extra"><Paragraph id="extra-old">hands off</Paragraph></Page>',
		};
		const insertOrder: string[] = [];
		const client = {
			async callToolJson<T>(name: string, args?: Record<string, unknown>): Promise<T> {
				if (name === "smartcanvas.get_top_level_pages") return { pages: [{ page_id: "root", title: "Root" }] } as T;
				if (name === "manage.query_file_info") return { type: "smartcanvas", title: "Root", url: "https://docs.qq.com/doc/test" } as T;
				if (name === "smartcanvas.read") {
					const pageId = String(args?.page_id);
					const content = remote[pageId] ?? "";
					const split = content.indexOf('<Paragraph id="root-old-20">');
					if (pageId === "root" && split >= 0 && !args?.next_token) {
						return { content: content.slice(0, split), next_token: "root-next" } as T;
					}
					if (pageId === "root" && split >= 0) {
						return { content: content.slice(split) } as T;
					}
					return { content } as T;
				}
				if (name === "smartcanvas.edit") {
					const id = String(args?.id);
					const pageId = id.startsWith("root-") ? "root" : id.split("-")[0]!;
					if (args?.action === "INSERT_BEFORE") {
						insertOrder.push(pageId);
						remote[pageId] = remote[pageId]!.replace(
							`<Paragraph id="${id}">`,
							`<Paragraph id="${pageId}-new">${String(args.content)}</Paragraph><Paragraph id="${id}">`,
						);
					}
					if (args?.action === "DELETE") {
						remote[pageId] = remote[pageId]!.replace(new RegExp(`<Paragraph id="${id}">[\\s\\S]*?<\\/Paragraph>`), "");
					}
					return {} as T;
				}
				throw new Error(name);
			},
		};
		const project: PublishProject = {
			schemaVersion: 1, id: "project", accountId: "account", sourceRootPath: "docs/root.md", allowedRootPath: "docs",
			remoteFileId: "file", remoteUrl: "", remoteRootPageId: "root", publicRead: false, embeddedMarkdownAsPage: false,
			maxDepth: 8, maxNotes: 200,
			pageMap: {
				"docs/root.md": { pageId: "root", parentPageId: null, localTitle: "Root", remoteTitle: "Root" },
				"docs/child.md": { pageId: "child", parentPageId: "root", localTitle: "Child", remoteTitle: "Child" },
				"docs/grand.md": { pageId: "grand", parentPageId: "child", localTitle: "Grand", remoteTitle: "Grand" },
			},
		};
		const data = structuredClone(DEFAULT_DATA);
		const preflight = await prepareProjectPreflight(project, repository, reader, client, data);
		expect(preflight.blockers).toEqual([]);
		expect(preflight.pages).toHaveLength(3);
		expect(data.remoteTreeCaches.project?.nodes.extra?.title).toBe("Remote only");

		const result = await executeProjectPublish(preflight, reader, client, data, async () => undefined);
		expect(result.published).toEqual(["docs/grand.md", "docs/child.md", "docs/root.md"]);
		expect(insertOrder).toEqual(["grand", "child", "root"]);
		expect(remote.root).toContain('id="child"');
		expect(remote.root).toContain('id="extra"');
		expect(remote.extra).toContain("hands off");
		expect(remote.root).not.toContain("root-old-");
	});
});

function local(path: string, title: string, links: LocalLink[] = []): LocalPageMetadata {
	return { path, title, aliases: [], links };
}

function link(resolvedPath: string, position: number): LocalLink {
	return { rawTarget: resolvedPath, displayText: resolvedPath, resolvedPath, isEmbed: false, hasSubpath: false, position };
}

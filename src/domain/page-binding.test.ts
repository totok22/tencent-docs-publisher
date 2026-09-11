import { describe, expect, it } from "vitest";
import type { LocalPageNode } from "./local-page-tree";
import { bindingsFromSelections, proposeBindings } from "./page-binding";
import type { RemotePageNode } from "../types";

describe("page binding", () => {
	it("matches only within the selected parent and follows title/file/alias priority", () => {
		const local = node("docs/index.md", "Overview", [], [
			node("docs/install.md", "Install"),
			node("docs/guide.md", "Frontmatter title", ["Manual"]),
		]);
		const remote = remoteFixture();
		const proposals = proposeBindings(local, "root", remote, {});
		expect(proposals.map((proposal) => [proposal.localPath, proposal.remotePageId, proposal.reason])).toEqual([
			["docs/index.md", "root", "根页面"],
			["docs/install.md", "install", "frontmatter title"],
			["docs/guide.md", "frontmatter", "frontmatter title"],
		]);
	});

	it("does not auto-select duplicate titles", () => {
		const local = node("index.md", "Root", [], [node("faq.md", "FAQ")]);
		const remote = remoteFixture();
		remote.root!.childPageIds.push("faq-2");
		remote["faq-1"] = remoteNode("faq-1", "root", "FAQ");
		remote["faq-2"] = remoteNode("faq-2", "root", "FAQ");
		remote.root!.childPageIds.push("faq-1");
		const proposal = proposeBindings(local, "root", remote, {})[1];
		expect(proposal?.status).toBe("ambiguous");
		expect(proposal?.candidatePageIds.sort()).toEqual(["faq-1", "faq-2"]);
	});

	it("protects a saved Page ID whose remote parent changed", () => {
		const local = node("index.md", "Root", [], [node("install.md", "Install")]);
		const remote = remoteFixture();
		remote.install!.parentPageId = "other-parent";
		const proposals = proposeBindings(local, "root", remote, {
			"install.md": { pageId: "install", parentPageId: "root", localTitle: "Install", remoteTitle: "Install" },
		});
		expect(proposals[1]?.status).toBe("hierarchy-changed");
	});

	it("marks missing local targets and leaves extra remote pages unbound", () => {
		const local = node("index.md", "Root", [], [node("missing.md", "Missing")]);
		const remote = remoteFixture();
		const proposals = proposeBindings(local, "root", remote, {});
		expect(proposals[1]?.status).toBe("missing");
		const boundIds = new Set(proposals.map((proposal) => proposal.remotePageId));
		expect(boundIds.has("other")).toBe(false);
	});

	it("validates manual bindings for unique pages and correct hierarchy", () => {
		const local = node("index.md", "Root", [], [node("install.md", "Install")]);
		const remote = remoteFixture();
		const proposals = proposeBindings(local, "root", remote, {});
		const mappings = bindingsFromSelections(
			proposals,
			{ "index.md": "root", "install.md": "install" },
			remote,
			{},
		);
		expect(mappings["install.md"]?.parentPageId).toBe("root");
		expect(() => bindingsFromSelections(
			proposals,
			{ "index.md": "root", "install.md": "nested-install" },
			remote,
			{},
		)).toThrow("远端父页面是“Other”，但本地父页面绑定到“Remote root”");
	});
});

function node(path: string, title: string, aliases: string[] = [], children: LocalPageNode[] = []): LocalPageNode {
	return { path, title, aliases, depth: path.split("/").length - 1, children };
}

function remoteFixture(): Record<string, RemotePageNode> {
	return {
		root: { ...remoteNode("root", null, "Remote root"), childPageIds: ["install", "frontmatter", "guide", "other"] },
		install: remoteNode("install", "root", "Install"),
		frontmatter: remoteNode("frontmatter", "root", "Frontmatter title"),
		guide: remoteNode("guide", "root", "guide"),
		other: { ...remoteNode("other", "root", "Other"), childPageIds: ["nested-install"] },
		"nested-install": remoteNode("nested-install", "other", "Install"),
	};
}

function remoteNode(pageId: string, parentPageId: string | null, title: string): RemotePageNode {
	return { pageId, parentPageId, title, childPageIds: [], contentFingerprint: pageId };
}

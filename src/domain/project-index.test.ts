import { describe, expect, it } from "vitest";
import { ProjectIndex } from "./project-index";
import type { PublishProject } from "../types";

describe("ProjectIndex", () => {
	it("looks up ids, source roots, bound pages, and allowed roots", () => {
		const first = project("first", "docs/index.md", "docs", ["docs/child.md"]);
		const second = project("second", "other.md", "", ["other-child.md"]);
		const index = new ProjectIndex();
		index.rebuild([first, second]);

		expect(index.projectById("second")).toBe(second);
		expect(index.projectForPath("docs/index.md")).toBe(first);
		expect(index.projectForPath("docs/child.md")).toBe(first);
		expect(index.projectForAllowedRoot("docs")).toBe(first);
	});

	it("is refreshed after page bindings or projects change", () => {
		const first = project("first", "index.md", "", []);
		const index = new ProjectIndex();
		index.rebuild([first]);
		expect(index.projectForPath("new.md")).toBeUndefined();

		first.pageMap["new.md"] = binding("new");
		index.rebuild([first]);
		expect(index.projectForPath("new.md")).toBe(first);

		index.rebuild([]);
		expect(index.projectById("first")).toBeUndefined();
	});

	it("keeps the first project when legacy data contains overlapping paths", () => {
		const first = project("first", "index.md", "", ["shared.md"]);
		const second = project("second", "other.md", "", ["shared.md"]);
		const index = new ProjectIndex();
		index.rebuild([first, second]);

		expect(index.projectForPath("shared.md")).toBe(first);
		expect(index.projectForAllowedRoot("")).toBe(first);
	});
});

function project(id: string, sourceRootPath: string, allowedRootPath: string, paths: string[]): PublishProject {
	return {
		schemaVersion: 1,
		id,
		accountId: "account",
		sourceRootPath,
		allowedRootPath,
		remoteFileId: `remote-${id}`,
		remoteUrl: "",
		remoteRootPageId: "root",
		publicRead: false,
		maxDepth: 8,
		maxNotes: 200,
		pageMap: Object.fromEntries(paths.map((path) => [path, binding(path)])),
	};
}

function binding(title: string): PublishProject["pageMap"][string] {
	return {
		pageId: `page-${title}`,
		parentPageId: null,
		localTitle: title,
		remoteTitle: title,
	};
}

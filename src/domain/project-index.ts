import type { PublishProject } from "../types";

/**
 * Read-optimized project lookup for UI callbacks.
 *
 * Obsidian invokes menu and command availability callbacks on its UI thread, so
 * those callbacks must not scan every project and every bound page.
 */
export class ProjectIndex {
	private readonly byId = new Map<string, PublishProject>();
	private readonly byPath = new Map<string, PublishProject>();
	private readonly byAllowedRoot = new Map<string, PublishProject>();

	rebuild(projects: readonly PublishProject[]): void {
		this.byId.clear();
		this.byPath.clear();
		this.byAllowedRoot.clear();

		for (const project of projects) {
			// Preserve Array.find semantics when malformed/legacy data contains duplicates.
			if (!this.byId.has(project.id)) this.byId.set(project.id, project);
			if (!this.byAllowedRoot.has(project.allowedRootPath)) {
				this.byAllowedRoot.set(project.allowedRootPath, project);
			}
			if (!this.byPath.has(project.sourceRootPath)) {
				this.byPath.set(project.sourceRootPath, project);
			}
			for (const path of Object.keys(project.pageMap)) {
				if (!this.byPath.has(path)) this.byPath.set(path, project);
			}
		}
	}

	projectById(id: string): PublishProject | undefined {
		return this.byId.get(id);
	}

	projectForPath(path: string): PublishProject | undefined {
		return this.byPath.get(path);
	}

	projectForAllowedRoot(path: string): PublishProject | undefined {
		return this.byAllowedRoot.get(path);
	}
}

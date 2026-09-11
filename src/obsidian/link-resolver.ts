import { MetadataCache, TFile, Vault, type LinkCache } from "obsidian";
import type { LocalLink, LocalPageMetadata, LocalPageRepository } from "../domain/local-page-tree";

export class ObsidianLocalPageRepository implements LocalPageRepository {
	constructor(private readonly vault: Vault, private readonly metadataCache: MetadataCache) {}

	async readPage(path: string): Promise<LocalPageMetadata> {
		const abstract = this.vault.getAbstractFileByPath(path);
		if (!(abstract instanceof TFile) || abstract.extension !== "md") {
			throw new Error(`Markdown 文件不存在：${path}`);
		}
		let cache = this.metadataCache.getFileCache(abstract);
		if (!cache) {
			// Most vaults already have metadata here. Only pay for a file read during
			// the uncommon cache warm-up window instead of rereading every page.
			await this.vault.cachedRead(abstract);
			cache = this.metadataCache.getFileCache(abstract);
		}
		const frontmatter = cache?.frontmatter;
		const title = typeof frontmatter?.title === "string" && frontmatter.title.trim()
			? frontmatter.title.trim()
			: abstract.basename;
		const aliases = normalizeAliases(frontmatter?.aliases ?? frontmatter?.alias);
		const links: LocalLink[] = [];
		for (const link of cache?.links ?? []) links.push(this.resolveLink(link, abstract.path, false));
		for (const embed of cache?.embeds ?? []) links.push(this.resolveLink(embed, abstract.path, true));
		return {
			path: abstract.path,
			title,
			aliases,
			links: links.sort((a, b) => a.position - b.position),
		};
	}

	private resolveLink(link: LinkCache, sourcePath: string, isEmbed: boolean): LocalLink {
		const hashIndex = link.link.indexOf("#");
		const linkPath = hashIndex >= 0 ? link.link.slice(0, hashIndex) : link.link;
		const destination = linkPath ? this.metadataCache.getFirstLinkpathDest(linkPath, sourcePath) : null;
		return {
			rawTarget: link.original,
			displayText: link.displayText || linkPath,
			resolvedPath: destination?.path ?? null,
			isEmbed,
			hasSubpath: hashIndex >= 0,
			position: link.position.start.offset,
		};
	}
}

function normalizeAliases(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.filter((alias): alias is string => typeof alias === "string");
	return [];
}

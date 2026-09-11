import { MetadataCache, TFile, Vault } from "obsidian";

export class ObsidianVaultReader {
	constructor(private readonly vault: Vault, private readonly metadataCache: MetadataCache) {}

	async readMarkdown(path: string): Promise<string> {
		const file = this.file(path, "md");
		return this.vault.cachedRead(file);
	}

	async readBinary(path: string): Promise<ArrayBuffer> {
		const abstract = this.vault.getAbstractFileByPath(path);
		if (!(abstract instanceof TFile)) throw new Error(`资源不存在：${path}`);
		return this.vault.readBinary(abstract);
	}

	resolvePath(target: string, sourcePath: string): string | null {
		return this.metadataCache.getFirstLinkpathDest(target, sourcePath)?.path ?? null;
	}

	private file(path: string, extension: string): TFile {
		const abstract = this.vault.getAbstractFileByPath(path);
		if (!(abstract instanceof TFile) || abstract.extension !== extension) throw new Error(`文件不存在：${path}`);
		return abstract;
	}
}

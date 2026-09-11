import type { App } from "obsidian";
import { TOKEN_SECRET_ID } from "../types";

export class TencentTokenStore {
	constructor(private readonly app: App) {}

	get(): string | null {
		const value = this.app.secretStorage.getSecret(TOKEN_SECRET_ID)?.trim();
		return value ? value : null;
	}

	set(token: string): void {
		const normalized = token.trim();
		if (!normalized) throw new Error("Token 不能为空。");
		this.app.secretStorage.setSecret(TOKEN_SECRET_ID, normalized);
	}

	clear(): void {
		// SecretStorage 1.11.4 has no delete method; an empty value is treated as absent.
		this.app.secretStorage.setSecret(TOKEN_SECRET_ID, "");
	}

	hasToken(): boolean {
		return this.get() !== null;
	}
}

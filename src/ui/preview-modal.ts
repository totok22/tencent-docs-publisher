import { App, Modal, Notice, Setting } from "obsidian";
import type { PagePreflight } from "../application/preflight";

export class PreviewModal extends Modal {
	constructor(
		app: App,
		private readonly previews: PagePreflight[],
		private readonly mode: "quick" | "refreshed",
		private readonly onPublish?: (allowConflict: boolean) => Promise<void>,
		private readonly summary?: string,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.mode === "quick" ? "快速发布预览" : "刷新后发布预检");
		if (this.summary) this.contentEl.createEl("p", { text: this.summary });
		if (this.mode === "quick") {
			const cacheTime = this.previews.find((preview) => preview.cacheFetchedAt)?.cacheFetchedAt;
			this.contentEl.createEl("p", {
				text: cacheTime ? `远端缓存获取于 ${new Date(cacheTime).toLocaleString()}。` : "缓存缺失：当前仅显示本地结果。",
			});
		}
		for (const preview of this.previews) {
			const setting = new Setting(this.contentEl)
				.setName(`${statusIcon(preview.status)} ${preview.localPath}`)
				.setDesc(`${statusLabel(preview.status)} · 图片 ${preview.assets.filter((asset) => asset.kind === "image").length} · PDF ${preview.assets.filter((asset) => asset.kind === "pdf").length}`);
			if (preview.errors.length) setting.descEl.createDiv({ text: preview.errors.join("；"), cls: "mod-warning" });
			if (preview.warnings.length) setting.descEl.createDiv({ text: preview.warnings.join("；") });
		}
		if (this.mode === "refreshed" && this.onPublish && this.previews.every((preview) => !["error", "unbound", "conflict"].includes(preview.status))) {
			new Setting(this.contentEl).addButton((button) =>
				button.setCta().setButtonText("确认发布").onClick(async () => {
					try {
						await this.onPublish?.(false);
						this.close();
					} catch (error) {
						new Notice(error instanceof Error ? error.message : "发布失败。");
					}
				}),
			);
		}
		if (this.mode === "refreshed" && this.onPublish && this.previews.length === 1 && this.previews[0]?.status === "conflict") {
			new Setting(this.contentEl)
				.setName("远端内容已被人工修改")
				.setDesc("此操作只确认覆盖一次；后续发布仍会重新检查冲突。")
				.addButton((button) => button.setWarning().setButtonText("明确覆盖一次").onClick(async () => {
					try {
						await this.onPublish?.(true);
						this.close();
					} catch (error) {
						new Notice(error instanceof Error ? error.message : "发布失败。");
					}
				}));
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

function statusIcon(status: PagePreflight["status"]): string {
	return { changed: "●", unchanged: "✓", conflict: "⚠", unbound: "!", error: "×" }[status];
}

function statusLabel(status: PagePreflight["status"]): string {
	return { changed: "有变化", unchanged: "未变化", conflict: "远端冲突", unbound: "未绑定", error: "预检错误" }[status];
}

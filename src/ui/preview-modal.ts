import { App, Modal, Notice, Setting } from "obsidian";
import type { PagePreflight } from "../application/preflight";

const STATUS_LABEL: Record<PagePreflight["status"], string> = {
	changed: "有改动，等待发布",
	unchanged: "与上次发布一致",
	conflict: "远端被改过，需要确认覆盖",
	unbound: "尚未绑定腾讯页面",
	error: "检查未通过",
};

const STATUS_ICON: Record<PagePreflight["status"], string> = {
	changed: "●",
	unchanged: "✓",
	conflict: "⚠",
	unbound: "!",
	error: "×",
};

const STATUS_HINT: Record<PagePreflight["status"], string> = {
	changed: "本地有改动，发布将更新该页面。",
	unchanged: "内容一致，发布将跳过。",
	conflict: "远端页面存在新的修改，覆盖需确认。",
	unbound: "尚未绑定对应页面，请先完成绑定。",
	error: "检查未通过，请处理后重试。",
};

export class PreviewModal extends Modal {
	constructor(
		app: App,
		private readonly previews: PagePreflight[],
		private readonly mode: "quick" | "refreshed",
		private readonly onPublish?: (allowConflictPaths: string[]) => Promise<void>,
		private readonly summary?: string,
	) {
		super(app);
	}

	onOpen(): void {
		const refreshed = this.mode === "refreshed";
		this.titleEl.setText(refreshed ? "发布前检查" : "发布预览（仅本地）");
		if (refreshed) {
			this.contentEl.createEl("p", { text: "已获取远端最新状态，确认后开始发布。" });
		} else {
			this.contentEl.createEl("p", { text: "本地离线预览（未连接远端）。" });
			const cacheTime = this.previews.find((preview) => preview.cacheFetchedAt)?.cacheFetchedAt;
			this.contentEl.createEl("p", {
				text: cacheTime ? "远端信息缓存于 " + new Date(cacheTime).toLocaleString() : "暂无远端缓存",
			});
		}
		if (this.summary) this.contentEl.createEl("p", { text: this.summary });

		for (const preview of this.previews) {
			const images = preview.assets.filter((asset) => asset.kind === "image").length;
			const pdfs = preview.assets.filter((asset) => asset.kind === "pdf").length;
			const setting = new Setting(this.contentEl)
				.setName(STATUS_ICON[preview.status] + " " + preview.localPath)
				.setDesc(STATUS_LABEL[preview.status] + " · 图片 " + images + " · PDF " + pdfs);
			setting.descEl.createDiv({ text: STATUS_HINT[preview.status] });
			if (preview.errors.length) setting.descEl.createDiv({ text: "需要处理：" + preview.errors.join("；"), cls: "mod-warning" });
			for (const warning of preview.warnings) setting.descEl.createDiv({ text: "提示：" + warning });
		}

		if (!refreshed || !this.onPublish) return;
		const conflicts = this.previews.filter((preview) => preview.status === "conflict");
		const blocked = this.previews.filter((preview) => preview.status === "unbound" || preview.status === "error");
		let overwriteConflicts = false;
		if (conflicts.length) {
			new Setting(this.contentEl)
				.setName("允许覆盖 " + conflicts.length + " 个被修改页面")
				.setDesc("勾选后将覆盖远端修改。")
				.addToggle((toggle) => toggle.setValue(false).onChange((value) => { overwriteConflicts = value; }));
		}
		if (blocked.length) {
			this.contentEl.createEl("p", {
				text: "有 " + blocked.length + " 个页面尚未就绪，需处理后再发布。",
				cls: "mod-warning",
			});
			return;
		}
		new Setting(this.contentEl).addButton((button) =>
			button.setCta().setButtonText("开始发布").onClick(async () => {
				try {
					await this.onPublish?.(overwriteConflicts ? conflicts.map((preview) => preview.localPath) : []);
					this.close();
				} catch (error) {
					new Notice(error instanceof Error ? error.message : "发布失败。");
				}
			}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}


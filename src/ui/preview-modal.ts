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
	changed: "发布会用本地内容替换这一页当前的正文。",
	unchanged: "本地和远端都没有变化，发布会跳过这一页。",
	conflict: "上次发布之后，腾讯文档里的这一页又被改动过（可能是手动编辑）。要用本地版本覆盖它，需要在下面勾选确认。",
	unbound: "这篇笔记还没有对应到腾讯文档里的页面，请先用「页面绑定」完成绑定。",
	error: "请先按下面的提示处理，再重新执行发布前检查。",
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
			this.contentEl.createEl("p", { text: "下面的状态来自刚刚读取的腾讯文档内容；只有点「开始发布」才会写入。" });
		} else {
			this.contentEl.createEl("p", { text: "离线预览：只显示本地会生成的内容，不读取腾讯文档，也不会写入任何内容。" });
			const cacheTime = this.previews.find((preview) => preview.cacheFetchedAt)?.cacheFetchedAt;
			this.contentEl.createEl("p", {
				text: cacheTime ? "远端信息来自 " + new Date(cacheTime).toLocaleString() + " 的缓存。" : "没有远端缓存，只能看到本地结果。",
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
				.setName("覆盖 " + conflicts.length + " 个被改动过的页面")
				.setDesc("勾选后这些页面会用本地内容替换腾讯文档里的现有内容；不勾选则只发布其他页面。")
				.addToggle((toggle) => toggle.setValue(false).onChange((value) => { overwriteConflicts = value; }));
		}
		if (blocked.length) {
			this.contentEl.createEl("p", {
				text: "有 " + blocked.length + " 个页面尚未就绪（未绑定或检查未通过），发布必须先把它们处理完。",
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


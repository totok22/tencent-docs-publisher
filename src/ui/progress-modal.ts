import { App, Modal, Setting } from "obsidian";
import type { PublishProgress } from "../application/publish-project";

export class ProgressModal extends Modal {
	private statusEl!: HTMLElement;
	readonly controller = new AbortController();

	constructor(app: App) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText("腾讯文档发布进度");
		this.statusEl = this.contentEl.createEl("p", { text: "正在准备…" });
		new Setting(this.contentEl).addButton((button) =>
			button.setWarning().setButtonText("在当前页面完成后取消").onClick(() => {
				this.controller.abort();
				button.setDisabled(true).setButtonText("正在取消…");
			}),
		);
	}

	update(progress: PublishProgress): void {
		const labels: Record<PublishProgress["stage"], string> = {
			prepare: "准备", assets: "处理资源", pages: "更新页面", permissions: "请求公开权限", verify: "验证页面",
		};
		this.statusEl?.setText(`${labels[progress.stage]} ${progress.completed}/${progress.total}${progress.pagePath ? `：${progress.pagePath}` : ""}`);
	}

	complete(message: string): void {
		this.statusEl?.setText(message);
		setTimeout(() => this.close(), 1_500);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

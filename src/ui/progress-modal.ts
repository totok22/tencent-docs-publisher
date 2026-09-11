import { App, Modal, Setting } from "obsidian";
import type { PublishProgress } from "../application/publish-project";

const STAGE_LABEL: Record<PublishProgress["stage"], string> = {
	prepare: "准备",
	assets: "上传图片与附件",
	pages: "写入页面",
	permissions: "设置公开权限",
	verify: "回读校验",
};

export class ProgressModal extends Modal {
	private statusEl!: HTMLElement;
	readonly controller = new AbortController();

	constructor(app: App) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText("正在发布到腾讯文档");
		this.statusEl = this.contentEl.createEl("p", { text: "正在准备…" });
		new Setting(this.contentEl).addButton((button) =>
			button.setDestructive().setButtonText("停止（当前页面写完后）").onClick(() => {
				this.controller.abort();
				button.setDisabled(true).setButtonText("正在停止…");
			}),
		);
	}

	update(progress: PublishProgress): void {
		const label = STAGE_LABEL[progress.stage];
		const position = progress.completed + "/" + progress.total;
		this.statusEl?.setText(progress.pagePath ? label + "（" + position + "）：" + progress.pagePath : label + "（" + position + "）");
	}

	complete(message: string): void {
		this.statusEl?.setText(message);
		window.setTimeout(() => this.close(), 2_000);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}


import { App, Modal, Setting, TFile } from "obsidian";

export class OverviewPickerModal extends Modal {
	constructor(app: App, private readonly files: TFile[], private readonly onSelect: (file: TFile) => void) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText("选择文件夹总览 Markdown");
		this.contentEl.createEl("p", { text: "文件夹中没有约定名称的唯一总览，请选择发布树根节点。" });
		for (const file of this.files) {
			new Setting(this.contentEl).setName(file.name).setDesc(file.path).addButton((button) =>
				button.setButtonText("选择").onClick(() => {
					this.onSelect(file);
					this.close();
				}),
			);
		}
	}
}

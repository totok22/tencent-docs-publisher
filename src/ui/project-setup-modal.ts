import { App, Modal, Notice, Setting, TFile, type TextComponent } from "obsidian";
import type { RemoteDocumentChoice } from "../tencent/documents";

export interface ProjectSetupValue {
	sourceRootPath: string;
	allowedRootPath: string;
	remoteFileId: string;
	publicRead: boolean;
}

export class ProjectSetupModal extends Modal {
	constructor(
		app: App,
		private readonly sourceFile: TFile,
		private readonly defaultPublicRead: boolean,
		private readonly onCreate: (value: ProjectSetupValue) => Promise<void>,
		private readonly findDocuments: (query?: string) => Promise<RemoteDocumentChoice[]>,
		private readonly createRootDocument: (title: string) => Promise<RemoteDocumentChoice>,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText("新建腾讯文档发布项目");
		this.contentEl.createEl("p", {
			text: "选择目标腾讯智能文档，建立页面对应关系。",
		});
		const folder = this.sourceFile.parent?.path === "/" ? "" : this.sourceFile.parent?.path ?? "";
		const value: ProjectSetupValue = {
			sourceRootPath: this.sourceFile.path,
			allowedRootPath: folder,
			remoteFileId: "",
			publicRead: this.defaultPublicRead,
		};
		new Setting(this.contentEl).setName("发布树根节点").setDesc(this.sourceFile.path);
		new Setting(this.contentEl)
			.setName("允许跟随的文件夹")
			.setDesc("限制子页面引用的目录范围。")
			.addText((text) => text.setValue(value.allowedRootPath).onChange((input) => { value.allowedRootPath = input.trim(); }));
		let fileIdInput: TextComponent | null = null;
		const fileIdSetting = new Setting(this.contentEl)
			.setName("目标文档 ID (file_ID)")
			.setDesc("腾讯智能文档的 file_ID。")
			.addText((text) => {
				fileIdInput = text;
				text.setPlaceholder("粘贴已知的 file_ID").onChange((input) => { value.remoteFileId = input.trim(); });
			});
		const resultsEl = this.contentEl.createDiv("tencent-docs-publisher-document-results");
		let query = "";
		new Setting(this.contentEl)
			.setName("从已有文档中选择")
			.setDesc("从最近文档列表或通过标题搜索选择文档。")
			.addText((text) => text.setPlaceholder("文档标题").onChange((input) => { query = input.trim(); }))
			.addButton((button) => button.setButtonText("最近").onClick(() => void this.renderChoices(resultsEl, this.findDocuments(), value, fileIdSetting, fileIdInput)))
			.addButton((button) => button.setButtonText("搜索").onClick(() => {
				if (!query) { new Notice("请先输入要搜索的标题关键词。"); return; }
				void this.renderChoices(resultsEl, this.findDocuments(query), value, fileIdSetting, fileIdInput);
			}));
		let newTitle = this.sourceFile.basename;
		new Setting(this.contentEl)
			.setName("新建智能文档")
			.setDesc("在腾讯文档中新建一篇空文档作为发布目标。")
			.addText((text) => text.setValue(newTitle).onChange((input) => { newTitle = input.trim(); }))
			.addButton((button) => button.setButtonText("新建").onClick(async () => {
				if (!newTitle) { new Notice("请填一个文档标题。"); return; }
				try {
					const created = await this.createRootDocument(newTitle);
					value.remoteFileId = created.fileId;
					fileIdInput?.setValue(created.fileId);
					fileIdSetting.descEl.setText("已选中新建的文档：" + created.title + "（" + created.fileId + "）");
				} catch (error) {
					new Notice(error instanceof Error ? error.message : "新建文档失败。");
				}
			}));
		new Setting(this.contentEl)
			.setName("请求全员可读")
			.setDesc("开启公开只读权限。")
			.addToggle((toggle) => toggle.setValue(value.publicRead).onChange((input) => { value.publicRead = input; }));
		new Setting(this.contentEl).addButton((button) =>
			button.setCta().setButtonText("创建并读取页面树").onClick(async () => {
				if (!value.remoteFileId) {
					new Notice("请先填好目标文档的 file_ID。");
					return;
				}
				button.setDisabled(true);
				try {
					await this.onCreate(value);
					this.close();
				} catch (error) {
					new Notice(error instanceof Error ? error.message : "创建发布项目失败。");
				} finally {
					button.setDisabled(false);
				}
			}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async renderChoices(
		container: HTMLElement,
		choicesPromise: Promise<RemoteDocumentChoice[]>,
		value: ProjectSetupValue,
		fileIdSetting: Setting,
		fileIdInput: TextComponent | null,
	): Promise<void> {
		container.empty();
		container.createEl("p", { text: "正在读取…" });
		try {
			const choices = await choicesPromise;
			container.empty();
			if (!choices.length) container.createEl("p", { text: "没有找到可访问的智能文档。" });
			for (const choice of choices) {
				new Setting(container).setName(choice.title).setDesc(choice.fileId).addButton((button) =>
					button.setButtonText("选择").onClick(() => {
						value.remoteFileId = choice.fileId;
						fileIdInput?.setValue(choice.fileId);
						fileIdSetting.descEl.setText("已选中：" + choice.title + "（" + choice.fileId + "）");
					}),
				);
			}
		} catch (error) {
			container.empty();
			container.createEl("p", { text: error instanceof Error ? error.message : "读取文档列表失败。" });
		}
	}
}


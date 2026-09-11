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
		this.titleEl.setText("创建腾讯文档发布项目");
		const folder = this.sourceFile.parent?.path === "/" ? "" : this.sourceFile.parent?.path ?? "";
		const value: ProjectSetupValue = {
			sourceRootPath: this.sourceFile.path,
			allowedRootPath: folder,
			remoteFileId: "",
			publicRead: this.defaultPublicRead,
		};
		new Setting(this.contentEl).setName("总览文件").setDesc(this.sourceFile.path);
		new Setting(this.contentEl)
			.setName("允许跟随的根文件夹")
			.setDesc("链接到该范围外的 Markdown 只保留为普通引用。")
			.addText((text) => text.setValue(value.allowedRootPath).onChange((input) => { value.allowedRootPath = input.trim(); }));
		let fileIdInput: TextComponent | null = null;
		const fileIdSetting = new Setting(this.contentEl)
			.setName("腾讯智能文档 file_id")
			.setDesc("必须是内部 file_id，不是从网页 URL 猜出的标识。")
			.addText((text) => {
				fileIdInput = text;
				text.setPlaceholder("输入已知 file_id").onChange((input) => { value.remoteFileId = input.trim(); });
			});
		const resultsEl = this.contentEl.createDiv("tencent-docs-publisher-document-results");
		let query = "";
		new Setting(this.contentEl)
			.setName("选择已有智能文档")
			.setDesc("可加载最近文档或按标题搜索；选择结果会填入上方 file_id。")
			.addText((text) => text.setPlaceholder("文档标题").onChange((input) => { query = input.trim(); }))
			.addButton((button) => button.setButtonText("最近").onClick(() => void this.renderChoices(resultsEl, awaitable(() => this.findDocuments()), value, fileIdSetting, fileIdInput)))
			.addButton((button) => button.setButtonText("搜索").onClick(() => {
				if (!query) { new Notice("请输入搜索关键词。"); return; }
				void this.renderChoices(resultsEl, awaitable(() => this.findDocuments(query)), value, fileIdSetting, fileIdInput);
			}));
		let newTitle = this.sourceFile.basename;
		new Setting(this.contentEl)
			.setName("或新建独立智能文档")
			.setDesc("只新建根智能文档，不会自动创建子页面。")
			.addText((text) => text.setValue(newTitle).onChange((input) => { newTitle = input.trim(); }))
			.addButton((button) => button.setButtonText("新建").onClick(async () => {
				if (!newTitle) { new Notice("请输入文档标题。"); return; }
				try {
					const created = await this.createRootDocument(newTitle);
					value.remoteFileId = created.fileId;
					fileIdInput?.setValue(created.fileId);
					fileIdSetting.descEl.setText(`已选择新文档：${created.title} (${created.fileId})`);
				} catch (error) {
					new Notice(error instanceof Error ? error.message : "新建文档失败。");
				}
			}));
		new Setting(this.contentEl)
			.setName("请求全员可读")
			.setDesc("只请求可读，不会设置全员可编辑。")
			.addToggle((toggle) => toggle.setValue(value.publicRead).onChange((input) => { value.publicRead = input; }));
		new Setting(this.contentEl).addButton((button) =>
			button.setCta().setButtonText("读取页面树并创建").onClick(async () => {
				if (!value.remoteFileId) {
					new Notice("请输入腾讯智能文档内部 file_id。");
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
						fileIdSetting.descEl.setText(`已选择：${choice.title} (${choice.fileId})`);
					}),
				);
			}
		} catch (error) {
			container.empty();
			container.createEl("p", { text: error instanceof Error ? error.message : "读取文档列表失败。" });
		}
	}
}

function awaitable<T>(callback: () => Promise<T>): Promise<T> {
	return callback();
}

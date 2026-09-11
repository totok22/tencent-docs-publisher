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
			text: "选一个腾讯智能文档作为发布目标，插件会读取它已有的子页面，再把这篇 Markdown 和它链接到的笔记对应过去。",
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
			.setDesc("只有这个范围内的 Markdown 才会被当成子页面；范围外的链接只保留文字。")
			.addText((text) => text.setValue(value.allowedRootPath).onChange((input) => { value.allowedRootPath = input.trim(); }));
		let fileIdInput: TextComponent | null = null;
		const fileIdSetting = new Setting(this.contentEl)
			.setName("目标智能文档 file_ID")
			.setDesc("填文档的内部 file_ID，不是网页地址里的那串字符。")
			.addText((text) => {
				fileIdInput = text;
				text.setPlaceholder("粘贴已知的 file_ID").onChange((input) => { value.remoteFileId = input.trim(); });
			});
		const resultsEl = this.contentEl.createDiv("tencent-docs-publisher-document-results");
		let query = "";
		new Setting(this.contentEl)
			.setName("或者直接挑一个")
			.setDesc("点「最近」列出最近编辑过的智能文档，或输入标题后点「搜索」。选中结果会自动填入上面的 file_ID。")
			.addText((text) => text.setPlaceholder("文档标题").onChange((input) => { query = input.trim(); }))
			.addButton((button) => button.setButtonText("最近").onClick(() => void this.renderChoices(resultsEl, this.findDocuments(), value, fileIdSetting, fileIdInput)))
			.addButton((button) => button.setButtonText("搜索").onClick(() => {
				if (!query) { new Notice("请先输入要搜索的标题关键词。"); return; }
				void this.renderChoices(resultsEl, this.findDocuments(query), value, fileIdSetting, fileIdInput);
			}));
		let newTitle = this.sourceFile.basename;
		new Setting(this.contentEl)
			.setName("或者新建一个空的智能文档")
			.setDesc("只会新建这份文档本身，子页面仍然要在腾讯文档里手动建好。")
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
			.setDesc("只请求只读权限，不会设置成全员可编辑。")
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


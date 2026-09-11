import { Notice, Plugin, TFile, Menu, MenuItem } from "obsidian";
import { TencentDocsPublisherSettings, DEFAULT_SETTINGS } from "./types";
import { TencentDocsSettingTab } from "./settings/settings-tab";

export default class TencentDocsPublisherPlugin extends Plugin {
	settings: TencentDocsPublisherSettings;

	async onload() {
		await this.loadSettings();

		// 1. 注册左侧 Ribbon 图标
		if (this.settings.showRibbonIcon) {
			this.addRibbonIcon("cloud-upload", "发布到腾讯文档 (Tencent Docs)", () => {
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile) {
					this.publishCurrentFile(activeFile);
				} else {
					new Notice("请先打开一个 Markdown 笔记");
				}
			});
		}

		// 2. 注册命令面板命令
		this.addCommand({
			id: "publish-current-file",
			name: "发布当前笔记到腾讯文档",
			checkCallback: (checking: boolean) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile && activeFile.extension === "md") {
					if (!checking) {
						this.publishCurrentFile(activeFile);
					}
					return true;
				}
				return false;
			}
		});

		this.addCommand({
			id: "sync-all-mapped-files",
			name: "同步所有已绑定的笔记",
			callback: () => {
				new Notice("开始同步所有已绑定的文档...");
			}
		});

		// 3. 注册文件列表与编辑器右键菜单
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu: Menu, file) => {
				if (file instanceof TFile && file.extension === "md") {
					menu.addItem((item: MenuItem) => {
						item
							.setTitle("发布到腾讯文档")
							.setIcon("cloud-upload")
							.onClick(() => {
								this.publishCurrentFile(file);
							});
					});
				}
			})
		);

		// 4. 注册插件设置面板
		this.addSettingTab(new TencentDocsSettingTab(this.app, this));

		console.log("Tencent Docs Publisher 插件已加载");
	}

	onunload() {
		console.log("Tencent Docs Publisher 插件已卸载");
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private async publishCurrentFile(file: TFile) {
		new Notice(`正在准备发布: ${file.basename} ...`);
		// 后续调度解析器与远端树同步逻辑
	}
}

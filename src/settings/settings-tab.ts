import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type TencentDocsPublisherPlugin from "../main";
import { TENCENT_MCP_ENDPOINT, TENCENT_TOKEN_URL } from "../types";

export class TencentDocsSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: TencentDocsPublisherPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl).setName("腾讯文档发布器").setHeading();

		new Setting(containerEl).setName("账户").setHeading();
		containerEl.createEl("p", {
			text: `固定服务地址：${TENCENT_MCP_ENDPOINT}`,
			cls: "setting-item-description",
		});
		new Setting(containerEl)
			.setName("获取腾讯文档 Token")
			.setDesc("在腾讯文档官方授权页面获取插件所需 Token。")
			.addButton((button) => button.setButtonText("打开授权页面").onClick(() => window.open(TENCENT_TOKEN_URL)));

		let pendingToken = "";
		new Setting(containerEl)
			.setName("腾讯文档 Token")
			.setDesc(this.plugin.tokenStore.hasToken() ? "已安全保存。输入新值可替换。" : "尚未配置。")
			.addText((text) => {
				text.inputEl.type = "password";
				text.setPlaceholder("粘贴 Token").onChange((value) => {
					pendingToken = value;
				});
			})
			.addButton((button) =>
				button.setButtonText("保存").onClick(async () => {
					try {
						await this.plugin.replaceToken(pendingToken);
						new Notice("Token 已保存到 Obsidian SecretStorage。");
						this.display();
					} catch (error) {
						new Notice(error instanceof Error ? error.message : "Token 保存失败。");
					}
				}),
			)
			.addButton((button) =>
				button.setButtonText("测试连接").onClick(async () => {
					await this.plugin.testConnection();
					this.display();
				}),
			)
			.addButton((button) =>
				button.setButtonText("清除").setWarning().onClick(async () => {
					this.plugin.clearToken();
					await this.plugin.savePluginData();
					new Notice("Token 已清除。");
					this.display();
				}),
			);

		new Setting(containerEl).setName("默认发布行为").setHeading();
		this.addToggle("新项目默认请求全员可读", "只会请求全员可读，永不设置可编辑。", "publicRead");
		this.addToggle("将 Markdown 嵌入视为子页面", "关闭时嵌入内容发布在当前页面。", "embeddedMarkdownAsPage");
		this.addToggle("遇到冲突时停止", "检测到远端人工修改时阻止写入。", "stopOnConflict");
		this.addToggle("跳过未变化页面", "完整内容与资源哈希均未变化时跳过。", "skipUnchanged");
		this.addNumber("最大递归深度", "范围 1–32，默认 8。", "maxDepth", 1, 32);
		this.addNumber("最大发布页面数", "范围 1–2000，默认 200。", "maxNotes", 1, 2_000);

		new Setting(containerEl)
			.setName("显示侧边栏按钮")
			.setDesc("在左侧工具栏显示发布入口。")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.data.showRibbonIcon).onChange(async (value) => {
					this.plugin.data.showRibbonIcon = value;
					await this.plugin.savePluginData();
				}),
			);

		new Setting(containerEl).setName("发布项目").setHeading();
		if (this.plugin.data.projects.length === 0) {
			containerEl.createEl("p", { text: "尚未创建发布项目。", cls: "setting-item-description" });
		}
		for (const project of this.plugin.data.projects) {
			new Setting(containerEl)
				.setName(project.sourceRootPath)
				.setDesc(`${project.remoteFileId} · 已绑定 ${Object.keys(project.pageMap).length} 页`)
				.addButton((button) => button.setButtonText("管理绑定").onClick(() => this.plugin.openBindingManager(project.id)))
				.addExtraButton((button) => button.setIcon("external-link").setTooltip("打开腾讯文档").onClick(() => this.plugin.openProjectDocument(project.id)))
				.addExtraButton((button) => button.setIcon("trash-2").setTooltip("仅移除本地项目").onClick(async () => {
					await this.plugin.removeProject(project.id);
					this.display();
				}));
		}

		new Setting(containerEl).setName("诊断").setHeading();
		new Setting(containerEl)
			.setName("最近发布任务")
			.setDesc(`保留 ${this.plugin.data.recentTasks.length} 条脱敏记录；Token、正文和上传地址不会记录。`)
			.addButton((button) =>
				button.setButtonText("清理本地缓存").onClick(async () => {
					this.plugin.data.remoteTreeCaches = {};
					await this.plugin.savePluginData();
					new Notice("远端树缓存已清理。");
				}),
			);
	}

	private addToggle(
		name: string,
		description: string,
		key: "publicRead" | "embeddedMarkdownAsPage" | "stopOnConflict" | "skipUnchanged",
	): void {
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(description)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.data.defaults[key]).onChange(async (value) => {
					this.plugin.data.defaults[key] = value;
					await this.plugin.savePluginData();
				}),
			);
	}

	private addNumber(
		name: string,
		description: string,
		key: "maxDepth" | "maxNotes",
		min: number,
		max: number,
	): void {
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(description)
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = String(min);
				text.inputEl.max = String(max);
				text.setValue(String(this.plugin.data.defaults[key])).onChange(async (value) => {
					const parsed = Number.parseInt(value, 10);
					if (Number.isInteger(parsed)) {
						this.plugin.data.defaults[key] = Math.max(min, Math.min(max, parsed));
						await this.plugin.savePluginData();
					}
				});
			});
	}
}

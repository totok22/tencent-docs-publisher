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
		containerEl.createEl("p", {
			text: "把 Obsidian 里的 Markdown 手动发布到腾讯智能文档。插件不会监听保存，也不会自动同步。",
			cls: "setting-item-description",
		});

		new Setting(containerEl).setName("账户").setHeading();
		new Setting(containerEl)
			.setName("获取腾讯文档 token")
			.setDesc("在腾讯文档官方授权页面获取插件所需的 token，然后粘贴到下面。")
			.addButton((button) => button.setButtonText("打开授权页面").onClick(() => window.open(TENCENT_TOKEN_URL)));

		let pendingToken = "";
		new Setting(containerEl)
			.setName("腾讯文档 token")
			.setDesc(this.plugin.tokenStore.hasToken() ? "已保存。要更换时粘贴新值再点保存。" : "还没有配置。")
			.addText((text) => {
				text.inputEl.type = "password";
				text.setPlaceholder("粘贴 token").onChange((value) => {
					pendingToken = value;
				});
			})
			.addButton((button) =>
				button.setButtonText("保存").onClick(async () => {
					try {
						await this.plugin.replaceToken(pendingToken);
						new Notice("token 已保存到 Obsidian 的凭据存储。");
						this.display();
					} catch (error) {
						new Notice(error instanceof Error ? error.message : "token 保存失败。");
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
					new Notice("token 已清除。");
					this.display();
				}),
			);
		containerEl.createEl("p", { text: "服务地址固定为 " + TENCENT_MCP_ENDPOINT + "，不可修改。", cls: "setting-item-description" });

		new Setting(containerEl).setName("新项目的默认行为").setHeading();
		this.addToggle("默认请求全员可读", "只请求可读，永远不会设置成全员可编辑。", "publicRead");
		this.addToggle("把「![[Markdown]]」当作子页面", "关闭时，嵌入的 Markdown 内容会直接写在当前页面里。", "embeddedMarkdownAsPage");
		this.addToggle("遇到冲突时停下来", "远端这一页在上次发布后又被改动过时，默认阻止覆盖；关闭后发布会直接覆盖，不再逐次确认。", "stopOnConflict");
		this.addToggle("跳过没有变化的页面", "本地内容和资源都没变时跳过，减少写入。", "skipUnchanged");
		this.addNumber("最大递归深度", "总览树最多往下跟几层链接，范围 1–32，默认 8。", "maxDepth", 1, 32);
		this.addNumber("最大页面数", "一次发布最多包含多少篇笔记，范围 1–2000，默认 200。", "maxNotes", 1, 2_000);

		new Setting(containerEl)
			.setName("在侧边栏显示入口")
			.setDesc("在左侧工具栏显示发布管理按钮。")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.data.showRibbonIcon).onChange(async (value) => {
					this.plugin.data.showRibbonIcon = value;
					await this.plugin.savePluginData();
				}),
			);

		new Setting(containerEl).setName("发布项目").setHeading();
		if (this.plugin.data.projects.length === 0) {
			containerEl.createEl("p", { text: "还没有发布项目。", cls: "setting-item-description" });
		}
		for (const project of this.plugin.data.projects) {
			new Setting(containerEl)
				.setName(project.sourceRootPath)
				.setDesc("已绑定 " + Object.keys(project.pageMap).length + " 页")
				.addButton((button) => button.setButtonText("页面绑定").onClick(() => this.plugin.openBindingManager(project.id)))
				.addExtraButton((button) => button.setIcon("external-link").setTooltip("在腾讯文档中打开").onClick(() => this.plugin.openProjectDocument(project.id)))
				.addExtraButton((button) => button.setIcon("trash-2").setTooltip("移除本地项目（不会删除腾讯文档）").onClick(async () => {
					await this.plugin.removeProject(project.id);
					this.display();
				}));
		}

		new Setting(containerEl).setName("诊断").setHeading();
		new Setting(containerEl)
			.setName("发布记录")
			.setDesc("保存 " + this.plugin.data.recentTasks.length + " 条脱敏记录，可在发布管理面板查看。token、正文和上传地址不会写入记录。")
			.addButton((button) =>
				button.setButtonText("清理远端缓存").onClick(async () => {
					this.plugin.data.remoteTreeCaches = {};
					await this.plugin.savePluginData();
					new Notice("已清理远端页面树缓存，下次会重新读取。");
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


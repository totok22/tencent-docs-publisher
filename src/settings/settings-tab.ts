import { App, Notice, PluginSettingTab, type Setting, type SettingDefinitionItem } from "obsidian";
import type TencentDocsPublisherPlugin from "../main";
import { TENCENT_TOKEN_URL } from "../types";

const SHOW_RIBBON_ICON_KEY = "showRibbonIcon";

export class TencentDocsSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: TencentDocsPublisherPlugin) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: "腾讯文档发布器",
				desc: "将 Obsidian 中的 Markdown 笔记发布到腾讯智能文档。",
			},
			{
				type: "group",
				heading: "账户",
				items: [
					{
						name: "获取腾讯文档 token",
						desc: "在腾讯文档官方授权页面获取插件所需的 token，然后粘贴到下面。",
						action: () => {
							window.open(TENCENT_TOKEN_URL);
						},
					},
					{
						name: "腾讯文档 token",
						desc: this.plugin.tokenStore.hasToken() ? "已配置" : "未配置",
						render: (setting: Setting) => this.renderTokenSetting(setting),
					},
				],
			},
			{
				type: "group",
				heading: "新项目的默认行为",
				items: [
					{
						name: "默认请求全员可读",
						desc: "新建项目时默认开启公开只读权限。",
						control: { type: "toggle", key: "publicRead" },
					},
					{
						name: "把「![[Markdown]]」当作子页面",
						desc: "嵌入的 Markdown 作为独立子页面发布；关闭时直接展开在当前页。",
						control: { type: "toggle", key: "embeddedMarkdownAsPage" },
					},
					{
						name: "遇到冲突时停下来",
						desc: "远端内容被修改时暂停发布并等待确认。",
						control: { type: "toggle", key: "stopOnConflict" },
					},
					{
						name: "跳过没有变化的页面",
						desc: "内容无变动时跳过发布。",
						control: { type: "toggle", key: "skipUnchanged" },
					},
					{
						name: "最大递归深度",
						desc: "链接抓取最大层数，范围 1–32，默认 8。",
						control: { type: "number", key: "maxDepth", min: 1, max: 32 },
					},
					{
						name: "最大页面数",
						desc: "单次发布最大笔记数，范围 1–2000，默认 200。",
						control: { type: "number", key: "maxNotes", min: 1, max: 2_000 },
					},
				],
			},
			{
				name: "在侧边栏显示入口",
				desc: "在左侧工具栏显示发布管理图标。",
				control: { type: "toggle", key: SHOW_RIBBON_ICON_KEY },
			},
			...this.projectDefinitions(),
			{
				type: "group",
				heading: "诊断",
				items: [
					{
						name: "清理远端缓存",
						desc: "清除本地缓存的远端页面结构数据，下次发布时重新读取。",
						action: () => {
							void this.clearRemoteCache();
						},
					},
				],
			},
		];
	}

	getControlValue(key: string): unknown {
		if (key === SHOW_RIBBON_ICON_KEY) return this.plugin.data.showRibbonIcon;
		switch (key) {
			case "publicRead":
			case "embeddedMarkdownAsPage":
			case "stopOnConflict":
			case "skipUnchanged":
			case "maxDepth":
			case "maxNotes":
				return this.plugin.data.defaults[key];
			default:
				return undefined;
		}
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		switch (key) {
			case "publicRead":
			case "embeddedMarkdownAsPage":
			case "stopOnConflict":
			case "skipUnchanged":
				this.plugin.data.defaults[key] = Boolean(value);
				break;
			case "maxDepth":
				this.plugin.data.defaults.maxDepth = clampNumber(value, 1, 32, this.plugin.data.defaults.maxDepth);
				break;
			case "maxNotes":
				this.plugin.data.defaults.maxNotes = clampNumber(value, 1, 2_000, this.plugin.data.defaults.maxNotes);
				break;
			case SHOW_RIBBON_ICON_KEY:
				this.plugin.data.showRibbonIcon = Boolean(value);
				break;
			default:
				return;
		}
		await this.plugin.savePluginData();
	}

	private projectDefinitions(): SettingDefinitionItem[] {
		const projects = this.plugin.data.projects;
		if (!projects.length) {
			return [{
				name: "发布项目",
				desc: "还没有发布项目。在 Markdown 文件或文件夹上右键即可新建。",
			}];
		}
		return [{
			type: "group",
			heading: "发布项目",
			items: projects.map((project) => ({
				name: project.sourceRootPath,
				desc: "已绑定 " + Object.keys(project.pageMap).length + " 页",
				render: (setting: Setting) => this.renderProjectSetting(setting, project.id),
			})),
		}];
	}

	private renderTokenSetting(setting: Setting): void {
		setting.setName("腾讯文档 token");
		setting.setDesc(this.plugin.tokenStore.hasToken() ? "已配置" : "未配置");
		let pendingToken = "";
		setting.addText((text) => {
			text.inputEl.type = "password";
			text.setPlaceholder("粘贴 token").onChange((value) => {
				pendingToken = value;
			});
		});
		setting.addButton((button) =>
			button.setButtonText("保存").onClick(async () => {
				try {
					await this.plugin.replaceToken(pendingToken);
					new Notice("Token 已保存到 Obsidian 的凭据存储。");
					this.update();
				} catch (error) {
					new Notice(error instanceof Error ? error.message : "token 保存失败。");
				}
			}),
		);
		setting.addButton((button) =>
			button.setButtonText("测试连接").onClick(async () => {
				await this.plugin.testConnection();
				this.update();
			}),
		);
		setting.addButton((button) =>
			button.setButtonText("清除").setDestructive().onClick(async () => {
				this.plugin.clearToken();
				await this.plugin.savePluginData();
				new Notice("Token 已清除。");
				this.update();
			}),
		);
	}

	private renderProjectSetting(setting: Setting, projectId: string): void {
		const project = this.plugin.data.projects.find((item) => item.id === projectId);
		if (!project) return;
		setting.setName(project.sourceRootPath);
		setting.setDesc("已绑定 " + Object.keys(project.pageMap).length + " 页");
		setting.addButton((button) =>
			button.setButtonText("页面绑定").onClick(() => this.plugin.openBindingManager(project.id)),
		);
		setting.addExtraButton((button) =>
			button.setIcon("external-link").setTooltip("在腾讯文档中打开").onClick(() => this.plugin.openProjectDocument(project.id)),
		);
		setting.addExtraButton((button) =>
			button.setIcon("trash-2").setTooltip("移除项目").onClick(() => {
				void this.plugin.removeProject(project.id).then((removed) => {
					if (removed) this.update();
				});
			}),
		);
	}

	private async clearRemoteCache(): Promise<void> {
		this.plugin.data.remoteTreeCaches = {};
		await this.plugin.savePluginData();
		new Notice("已清理远端页面树缓存，下次会重新读取。");
	}
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
	const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
	if (!Number.isInteger(parsed)) return fallback;
	return Math.max(min, Math.min(max, parsed));
}

import { App, PluginSettingTab, Setting } from "obsidian";
import type TencentDocsPublisherPlugin from "../main";

export class TencentDocsSettingTab extends PluginSettingTab {
	plugin: TencentDocsPublisherPlugin;

	constructor(app: App, plugin: TencentDocsPublisherPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Tencent Docs Publisher 设置" });

		new Setting(containerEl)
			.setName("腾讯文档服务地址 / MCP Endpoint")
			.setDesc("用于与腾讯文档进行数据同步的网关地址或本地 MCP 代理地址")
			.addText(text =>
				text
					.setPlaceholder("http://localhost:3000")
					.setValue(this.plugin.settings.mcpServerUrl)
					.onChange(async (value) => {
						this.plugin.settings.mcpServerUrl = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("默认知识库空间 ID")
			.setDesc("发布未显式指定空间的新文档时的目标空间 ID")
			.addText(text =>
				text
					.setPlaceholder("例如 space_xxxx")
					.setValue(this.plugin.settings.defaultSpaceId)
					.onChange(async (value) => {
						this.plugin.settings.defaultSpaceId = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("显示侧边栏 Ribbon 按钮")
			.setDesc("在 Obsidian 左侧工具栏显示一键发布与同步图标")
			.addToggle(toggle =>
				toggle
					.setValue(this.plugin.settings.showRibbonIcon)
					.onChange(async (value) => {
						this.plugin.settings.showRibbonIcon = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("已绑定的文档映射数量")
			.setDesc(`当前 Vault 中已存在 ${this.plugin.settings.mappings.length} 个同步映射关系`)
			.addButton(btn =>
				btn
					.setButtonText("查看 / 管理映射")
					.onClick(() => {
						// 后续打开映射管理 Modal
					})
			);
	}
}

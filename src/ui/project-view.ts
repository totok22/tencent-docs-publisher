import { ItemView, Setting, WorkspaceLeaf } from "obsidian";
import type TencentDocsPublisherPlugin from "../main";

export const PROJECT_VIEW_TYPE = "tencent-docs-publisher-projects";

export class ProjectView extends ItemView {
	constructor(leaf: WorkspaceLeaf, private readonly plugin: TencentDocsPublisherPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return PROJECT_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "腾讯文档发布管理";
	}

	getIcon(): string {
		return "cloud-upload";
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	render(): void {
		const container = this.contentEl;
		container.empty();
		container.createEl("h2", { text: "腾讯文档发布管理" });
		if (!this.plugin.data.projects.length) container.createEl("p", { text: "尚未创建发布项目。" });
		for (const project of this.plugin.data.projects) {
			const cache = this.plugin.data.remoteTreeCaches[project.id];
			new Setting(container)
				.setName(project.sourceRootPath)
				.setDesc(`${project.remoteFileId} · 绑定 ${Object.keys(project.pageMap).length} 页${cache ? ` · 缓存 ${new Date(cache.fetchedAt).toLocaleString()}` : " · 无远端缓存"}`)
				.addButton((button) => button.setButtonText("预览").onClick(() => this.plugin.previewProject(project.id)))
				.addButton((button) => button.setCta().setButtonText("发布").onClick(() => this.plugin.publishProject(project.id)))
				.addExtraButton((button) => button.setIcon("refresh-cw").setTooltip("刷新并管理绑定").onClick(() => this.plugin.openBindingManager(project.id)))
				.addExtraButton((button) => button.setIcon("external-link").setTooltip("打开腾讯文档").onClick(() => this.plugin.openProjectDocument(project.id)))
				.addExtraButton((button) => button.setIcon("trash-2").setTooltip("仅移除本地项目").onClick(async () => {
					await this.plugin.removeProject(project.id);
					this.render();
				}));
		}
		container.createEl("h3", { text: "最近任务" });
		for (const task of this.plugin.data.recentTasks.slice(0, 20)) {
			new Setting(container)
				.setName(`${task.status} · ${task.stage}`)
				.setDesc(`${new Date(task.finishedAt).toLocaleString()} · ${task.completedPages}/${task.totalPages}${task.traceId ? ` · trace ${task.traceId}` : ""}`);
		}
	}
}

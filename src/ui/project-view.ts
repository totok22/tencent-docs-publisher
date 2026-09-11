import { ItemView, Setting, WorkspaceLeaf } from "obsidian";
import type TencentDocsPublisherPlugin from "../main";
import type { PublishTaskRecord } from "../types";

export const PROJECT_VIEW_TYPE = "tencent-docs-publisher-projects";

const TASK_STATUS: Record<PublishTaskRecord["status"], string> = {
	completed: "已完成",
	failed: "失败",
	cancelled: "已取消",
	"remote-state-unknown": "远端状态未知",
};

const TASK_STAGE: Record<string, string> = {
	verified: "已回读校验",
	publish: "发布",
	cancelled: "已取消",
	"insert-page-content": "写入正文",
	"delete-old-block": "清理旧内容",
	"restore-page": "恢复失败前的内容",
	"restore-insert": "恢复失败前的内容",
	"restore-delete": "恢复失败前的内容",
	"read-page": "读取页面",
	"verify-page": "回读校验",
	"verify-project-access": "检查文档权限",
};

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
		if (!this.plugin.data.projects.length) {
			container.createEl("p", { text: "还没有发布项目。在 Markdown 文件或文件夹上右键，选择「用…新建发布项目」即可开始。" });
		}
		for (const project of this.plugin.data.projects) {
			const cache = this.plugin.data.remoteTreeCaches[project.id];
			const published = Object.values(project.pageMap)
				.map((binding) => binding.lastPublishedAt)
				.filter((value): value is string => Boolean(value))
				.sort()
				.pop();
			const details = [
				"已绑定 " + Object.keys(project.pageMap).length + " 页",
				published ? "上次发布 " + new Date(published).toLocaleString() : "尚未发布过",
				cache ? "远端信息更新于 " + new Date(cache.fetchedAt).toLocaleString() : "还没有远端信息",
			];
			new Setting(container)
				.setName(project.sourceRootPath)
				.setDesc(details.join(" · "))
				.addButton((button) => button.setButtonText("预览").onClick(() => this.plugin.previewProject(project.id)))
				.addButton((button) => button.setCta().setButtonText("发布").onClick(() => this.plugin.publishProject(project.id)))
				.addExtraButton((button) => button.setIcon("refresh-cw").setTooltip("刷新远端页面树并管理绑定").onClick(() => this.plugin.openBindingManager(project.id)))
				.addExtraButton((button) => button.setIcon("external-link").setTooltip("在腾讯文档中打开").onClick(() => this.plugin.openProjectDocument(project.id)))
				.addExtraButton((button) => button.setIcon("trash-2").setTooltip("移除本地项目（不会删除腾讯文档）").onClick(async () => {
					await this.plugin.removeProject(project.id);
					this.render();
				}));
		}
		container.createEl("h3", { text: "最近任务" });
		const tasks = this.plugin.data.recentTasks.slice(0, 20);
		if (!tasks.length) container.createEl("p", { text: "还没有发布记录。" });
		for (const task of tasks) {
			const project = this.plugin.data.projects.find((item) => item.id === task.projectId);
			const stage = TASK_STAGE[task.stage] ?? `其他步骤（${task.stage}）`;
			const parts = [
				TASK_STATUS[task.status] + " · " + stage,
				new Date(task.finishedAt).toLocaleString(),
				"成功 " + task.completedPages + "/" + task.totalPages + " 页",
			];
			if (project) parts.push(project.sourceRootPath);
			const setting = new Setting(container).setName(parts.join(" · "));
			if (task.error) setting.setDesc("原因：" + task.error);
			else if (task.traceId) setting.setDesc("诊断编号 " + task.traceId);
		}
	}
}


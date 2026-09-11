import { Menu, Notice, Plugin, TFile, TFolder, type MenuItem } from "obsidian";
import { migrateData } from "./domain/publish-state";
import { bindingsFromSelections } from "./domain/page-binding";
import { discoverLocalPageTree } from "./domain/local-page-tree";
import { refreshBindings } from "./application/refresh-bindings";
import { preflightPage } from "./application/preflight";
import { publishPreparedPage } from "./application/publish-page";
import { executeProjectPublish, prepareProjectPreflight, type ProjectPreflight } from "./application/publish-project";
import { applyResolvedAssets } from "./convert/markdown-to-mdx";
import { ObsidianLocalPageRepository } from "./obsidian/link-resolver";
import { ObsidianVaultReader } from "./obsidian/vault-reader";
import { TencentTokenStore } from "./obsidian/secret-store";
import { TencentDocsSettingTab } from "./settings/settings-tab";
import { TencentMcpClient } from "./tencent/mcp-client";
import { obsidianMcpTransport } from "./tencent/obsidian-transport";
import { PublishAssetResolver } from "./tencent/assets";
import { uploadBinary } from "./tencent/binary-upload";
import { PublisherError } from "./tencent/errors";
import { findSmartcanvasDocuments, type RemoteDocumentChoice } from "./tencent/documents";
import { BindingModal } from "./ui/binding-modal";
import { ProjectSetupModal, type ProjectSetupValue } from "./ui/project-setup-modal";
import { PreviewModal } from "./ui/preview-modal";
import { ProgressModal } from "./ui/progress-modal";
import { OverviewPickerModal } from "./ui/overview-picker-modal";
import { PROJECT_VIEW_TYPE, ProjectView } from "./ui/project-view";
import {
	COMMAND_IDS,
	type PublishProject,
	type TencentDocsPublisherData,
} from "./types";

export default class TencentDocsPublisherPlugin extends Plugin {
	data!: TencentDocsPublisherData;
	tokenStore!: TencentTokenStore;

	async onload(): Promise<void> {
		this.data = migrateData(await this.loadData());
		this.tokenStore = new TencentTokenStore(this.app);
		await this.savePluginData();

		if (this.data.showRibbonIcon) {
			this.addRibbonIcon("cloud-upload", "腾讯文档发布：打开发布管理", () => {
				this.openPublishManager();
			});
		}

		this.registerCommands();
		this.registerMenus();
		this.registerView(PROJECT_VIEW_TYPE, (leaf) => new ProjectView(leaf, this));
		this.addSettingTab(new TencentDocsSettingTab(this.app, this));
	}

	async savePluginData(): Promise<void> {
		await this.saveData(this.data);
	}

	async replaceToken(token: string): Promise<void> {
		this.tokenStore.set(token);
		this.data.verifiedAccountId = null;
		for (const project of this.data.projects) project.accountConfirmationRequired = true;
		await this.savePluginData();
	}

	clearToken(): void {
		this.tokenStore.clear();
		this.data.verifiedAccountId = null;
		for (const project of this.data.projects) project.accountConfirmationRequired = true;
	}

	async testConnection(): Promise<void> {
		const token = this.tokenStore.get();
		if (!token) {
			new Notice("请先保存 Token。");
			return;
		}
		try {
			const client = new TencentMcpClient(token, obsidianMcpTransport);
			const identity = await client.testConnection();
			this.data.verifiedAccountId = identity.accountId;
			for (const project of this.data.projects) {
				try {
					const info = await client.callToolJson<Record<string, unknown>>(
						"manage.query_file_info",
						{ file_id: project.remoteFileId },
						"verify-project-access",
					);
					project.accountConfirmationRequired = info.type !== "smartcanvas";
					if (!project.accountConfirmationRequired) project.accountId = identity.accountId;
				} catch {
					project.accountConfirmationRequired = true;
				}
			}
			await this.savePluginData();
			new Notice(`连接成功：${identity.displayName}`);
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "连接测试失败。");
		}
	}

	openBindingManager(projectId?: string): void {
		const project = projectId ? this.data.projects.find((item) => item.id === projectId) : undefined;
		if (project) {
			void this.refreshAndOpenBinding(project);
			return;
		}
		const file = this.activeMarkdown();
		if (!file) {
			new Notice("请先打开一篇 Markdown。");
			return;
		}
		if (!this.tokenStore.hasToken() || !this.data.verifiedAccountId) {
			new Notice("请先在设置中保存 Token 并测试连接。");
			return;
		}
		this.openProjectSetup(file);
	}

	previewProject(projectId: string): void {
		const project = this.data.projects.find((item) => item.id === projectId);
		if (project) void this.showTreePreview(project, "quick", false);
	}

	publishProject(projectId: string): void {
		const project = this.data.projects.find((item) => item.id === projectId);
		if (project) void this.showTreePreview(project, "refreshed", true);
	}

	openProjectDocument(projectId: string): void {
		const project = this.data.projects.find((item) => item.id === projectId);
		if (project?.remoteUrl) window.open(project.remoteUrl);
	}

	async removeProject(projectId: string): Promise<void> {
		if (!window.confirm("只移除此 Vault 中的发布项目？腾讯文档不会被删除。")) return;
		this.data.projects = this.data.projects.filter((project) => project.id !== projectId);
		delete this.data.remoteTreeCaches[projectId];
		await this.savePluginData();
		new Notice("仅已移除本地发布项目；腾讯文档未被修改。");
	}

	private registerCommands(): void {
		this.addCommand({
			id: COMMAND_IDS.publishCurrentPage,
			name: "腾讯文档发布：发布当前页面",
			checkCallback: (checking) => this.checkBoundMarkdown(checking, () => this.publishCurrentPage()),
		});
		this.addCommand({
			id: COMMAND_IDS.previewCurrentPage,
			name: "腾讯文档发布：预览当前页面",
			checkCallback: (checking) => this.checkBoundMarkdown(checking, () => this.previewCurrentPage(), false),
		});
		this.addCommand({
			id: COMMAND_IDS.publishCurrentTree,
			name: "腾讯文档发布：发布当前总览树",
			checkCallback: (checking) => this.checkProjectMarkdown(checking, () => this.publishCurrentTree()),
		});
		this.addCommand({
			id: COMMAND_IDS.previewCurrentTree,
			name: "腾讯文档发布：预览当前总览树",
			checkCallback: (checking) => this.checkProjectMarkdown(checking, () => this.previewCurrentTree(), false),
		});
		this.addCommand({
			id: COMMAND_IDS.manageBinding,
			name: "腾讯文档发布：创建或管理绑定",
			checkCallback: (checking) => {
				const file = this.activeMarkdown();
				if (!file) return false;
				if (!checking) this.openBindingManager(this.projectForPath(file.path)?.id);
				return true;
			},
		});
		this.addCommand({
			id: COMMAND_IDS.refreshRemoteTree,
			name: "腾讯文档发布：刷新远端页面树",
			checkCallback: (checking) => this.checkProjectMarkdown(checking, () => this.refreshRemoteTree()),
		});
		this.addCommand({
			id: COMMAND_IDS.openRemoteDocument,
			name: "腾讯文档发布：打开对应远端文档",
			checkCallback: (checking) => this.checkBoundMarkdown(checking, () => this.openRemoteDocument(), false),
		});
		this.addCommand({
			id: COMMAND_IDS.openPublishManager,
			name: "腾讯文档发布：打开发布管理",
			callback: () => this.openPublishManager(),
		});
	}

	private registerMenus(): void {
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu: Menu, file) => {
				if (file instanceof TFile && file.extension === "md") {
					this.addMenuItem(menu, "发布当前页面", "cloud-upload", () => this.publishFile(file));
					this.addMenuItem(menu, "预览当前页面", "scan-eye", () => this.previewFile(file));
					this.addMenuItem(menu, "设为总览并创建发布项目…", "folder-tree", () => this.openProjectSetup(file));
					this.addMenuItem(menu, "管理页面绑定…", "link", () => this.openBindingManager(this.projectForPath(file.path)?.id));
					this.addMenuItem(menu, "在腾讯文档中打开", "external-link", () => this.openRemoteForFile(file));
				} else if (file instanceof TFolder) {
					const project = this.data.projects.find((item) => item.allowedRootPath === file.path);
					this.addMenuItem(menu, "从此文件夹创建发布项目…", "folder-tree", () => this.createProjectFromFolder(file));
					if (project) {
						this.addMenuItem(menu, "发布此文件夹的总览树", "cloud-upload", () => this.publishProject(project.id));
						this.addMenuItem(menu, "预览此文件夹的总览树", "scan-eye", () => this.previewProject(project.id));
						this.addMenuItem(menu, "刷新远端页面树", "refresh-cw", () => this.openBindingManager(project.id));
					}
				}
			}),
		);
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu: Menu) => {
				const file = this.activeMarkdown();
				if (!file) return;
				this.addMenuItem(menu, "发布当前页面", "cloud-upload", () => this.publishFile(file));
				this.addMenuItem(menu, "预览当前页面", "scan-eye", () => this.previewFile(file));
			}),
		);
	}

	private addMenuItem(menu: Menu, title: string, icon: string, action: () => void): void {
		menu.addItem((item: MenuItem) => item.setTitle(title).setIcon(icon).onClick(action));
	}

	private checkBoundMarkdown(checking: boolean, action: () => void, requireRemote = true): boolean {
		const file = this.activeMarkdown();
		const project = file ? this.projectForPath(file.path) : undefined;
		const available = Boolean(
			file && project && project.pageMap[file.path] && (!requireRemote || this.canUseRemote(project)),
		);
		if (available && !checking) action();
		return available;
	}

	private checkProjectMarkdown(checking: boolean, action: () => void, requireRemote = true): boolean {
		const file = this.activeMarkdown();
		const project = file ? this.projectForPath(file.path) : undefined;
		const available = Boolean(file && project && (!requireRemote || this.canUseRemote(project)));
		if (available && !checking) action();
		return available;
	}

	private activeMarkdown(): TFile | null {
		const file = this.app.workspace.getActiveFile();
		return file?.extension === "md" ? file : null;
	}

	private projectForPath(path: string): PublishProject | undefined {
		return this.data.projects.find(
			(project) =>
				project.sourceRootPath === path || Object.prototype.hasOwnProperty.call(project.pageMap, path),
		);
	}

	private publishCurrentPage(): void {
		const file = this.activeMarkdown();
		if (file) this.publishFile(file);
	}

	private previewCurrentPage(): void {
		const file = this.activeMarkdown();
		if (file) this.previewFile(file);
	}

	private publishCurrentTree(): void {
		const file = this.activeMarkdown();
		const project = file ? this.projectForPath(file.path) : undefined;
		if (project) void this.showTreePreview(project, "refreshed", true);
	}

	private previewCurrentTree(): void {
		const file = this.activeMarkdown();
		const project = file ? this.projectForPath(file.path) : undefined;
		if (project) void this.showTreePreview(project, "quick", false);
	}

	private refreshRemoteTree(): void {
		const file = this.activeMarkdown();
		const project = file ? this.projectForPath(file.path) : undefined;
		if (project) void this.refreshAndOpenBinding(project);
	}

	private openRemoteDocument(): void {
		const file = this.activeMarkdown();
		if (file) this.openRemoteForFile(file);
	}

	private openPublishManager(): void {
		void (async () => {
			let leaf = this.app.workspace.getLeavesOfType(PROJECT_VIEW_TYPE)[0];
			if (!leaf) {
				leaf = this.app.workspace.getLeaf(true);
				await leaf.setViewState({ type: PROJECT_VIEW_TYPE, active: true });
			}
			await this.app.workspace.revealLeaf(leaf);
		})();
	}

	private publishFile(file: TFile): void {
		void this.showPagePreview(file, "refreshed", true);
	}

	private previewFile(file: TFile): void {
		void this.showPagePreview(file, "quick", false);
	}

	private openRemoteForFile(file: TFile): void {
		const project = this.projectForPath(file.path);
		if (!project) {
			new Notice("当前页面尚未绑定腾讯文档。");
			return;
		}
		if (!project.remoteUrl) {
			new Notice("该项目尚未保存可打开的腾讯文档 URL，请先刷新远端页面树。");
			return;
		}
		window.open(project.remoteUrl);
		const title = project.pageMap[file.path]?.remoteTitle;
		if (title) new Notice(`已打开所属文档；目标子页面：${title}`);
	}

	private createClient(): TencentMcpClient {
		const token = this.tokenStore.get();
		if (!token) throw new Error("尚未配置腾讯文档 Token。");
		return new TencentMcpClient(token, obsidianMcpTransport);
	}

	private canUseRemote(project: PublishProject): boolean {
		return Boolean(
			this.tokenStore.hasToken() &&
			this.data.verifiedAccountId &&
			project.accountId === this.data.verifiedAccountId &&
			!project.accountConfirmationRequired,
		);
	}

	private async createProject(value: ProjectSetupValue): Promise<void> {
		const accountId = this.data.verifiedAccountId;
		if (!accountId) throw new Error("请先测试连接并确认账号。");
		const project: PublishProject = {
			schemaVersion: 1,
			id: crypto.randomUUID(),
			accountId,
			sourceRootPath: value.sourceRootPath,
			allowedRootPath: value.allowedRootPath,
			remoteFileId: value.remoteFileId,
			remoteUrl: "",
			remoteRootPageId: "",
			publicRead: value.publicRead,
			embeddedMarkdownAsPage: this.data.defaults.embeddedMarkdownAsPage,
			maxDepth: this.data.defaults.maxDepth,
			maxNotes: this.data.defaults.maxNotes,
			pageMap: {},
		};
		this.data.projects.push(project);
		try {
			await this.refreshAndOpenBinding(project);
		} catch (error) {
			this.data.projects = this.data.projects.filter((item) => item.id !== project.id);
			throw error;
		}
	}

	private openProjectSetup(file: TFile): void {
		if (!this.tokenStore.hasToken() || !this.data.verifiedAccountId) {
			new Notice("请先在设置中保存 Token 并测试连接。");
			return;
		}
		new ProjectSetupModal(
			this.app,
			file,
			this.data.defaults.publicRead,
			async (value) => this.createProject(value),
			async (query) => this.findRemoteDocuments(query),
			async (title) => this.createRemoteRootDocument(title),
		).open();
	}

	private createProjectFromFolder(folder: TFolder): void {
		const markdown = folder.children.filter((child): child is TFile => child instanceof TFile && child.extension === "md");
		const preferredNames = ["README.md", "index.md", `${folder.name}.md`];
		for (const name of preferredNames) {
			const match = markdown.find((file) => file.name.toLocaleLowerCase() === name.toLocaleLowerCase());
			if (match) {
				this.openProjectSetup(match);
				return;
			}
		}
		if (markdown.length === 1 && markdown[0]) {
			this.openProjectSetup(markdown[0]);
			return;
		}
		if (!markdown.length) {
			new Notice("该文件夹内没有 Markdown，无法选择总览。");
			return;
		}
		new OverviewPickerModal(this.app, markdown, (file) => this.openProjectSetup(file)).open();
	}

	private async findRemoteDocuments(query?: string): Promise<RemoteDocumentChoice[]> {
		return findSmartcanvasDocuments(this.createClient(), query);
	}

	private async createRemoteRootDocument(title: string): Promise<RemoteDocumentChoice> {
		if (title.length > 36) throw new Error("腾讯文档标题不能超过 36 个字符。");
		const response = await this.createClient().callToolJson<Record<string, unknown>>(
			"manage.create_file", { title, file_type: "smartcanvas" }, "create-root-document",
		);
		const fileId = stringField(response, ["file_id", "fileId"]);
		if (!fileId) throw new Error("新建文档响应缺少 file_id。");
		return {
			fileId,
			title: stringField(response, ["title"]) ?? title,
			url: stringField(response, ["url", "file_url"]) ?? "",
		};
	}

	private async refreshAndOpenBinding(project: PublishProject): Promise<void> {
		try {
			const repository = new ObsidianLocalPageRepository(this.app.vault, this.app.metadataCache);
			const result = await refreshBindings(project, repository, this.createClient(), project.embeddedMarkdownAsPage ?? this.data.defaults.embeddedMarkdownAsPage);
			this.data.remoteTreeCaches[project.id] = result.cache;
			if (result.remoteUrl) project.remoteUrl = result.remoteUrl;
			const rootId = result.proposals[0]?.remotePageId;
			if (rootId) project.remoteRootPageId = rootId;
			new BindingModal(this.app, result.proposals, result.cache.nodes, async (selections) => {
				project.pageMap = bindingsFromSelections(result.proposals, selections, result.cache.nodes, project.pageMap);
				await this.savePluginData();
				new Notice("页面绑定已保存；尚未开始发布。");
			}).open();
			await this.savePluginData();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "刷新远端页面树失败。");
			throw error;
		}
	}

	private async showPagePreview(file: TFile, mode: "quick" | "refreshed", allowPublish: boolean): Promise<void> {
		const project = this.projectForPath(file.path);
		if (!project) {
			new Notice("当前页面尚未加入发布项目。");
			return;
		}
		if (mode === "refreshed" && !this.canUseRemote(project)) {
			new Notice("请先测试当前 Token，并确认它可以访问该项目的腾讯文档。");
			return;
		}
		try {
			const reader = new ObsidianVaultReader(this.app.vault, this.app.metadataCache);
			const client = mode === "refreshed" ? this.createClient() : undefined;
			const preview = await preflightPage(
				reader,
				project,
				file.path,
				mode,
				client,
				this.data.remoteTreeCaches[project.id],
				project.embeddedMarkdownAsPage ?? this.data.defaults.embeddedMarkdownAsPage,
			);
			new PreviewModal(this.app, [preview], mode, allowPublish ? async (allowConflict) => {
				const startedAt = new Date().toISOString();
				const publishClient = this.createClient();
				try {
					const assets = await new PublishAssetResolver(
						publishClient,
						reader,
						this.data.importedPdfs,
						uploadBinary,
					).resolve(preview.assets);
					const mdx = applyResolvedAssets(preview.conversion, assets.urls);
					await publishPreparedPage(publishClient, project, preview, mdx, allowConflict);
					this.recordTask(project.id, startedAt, "completed", 1, 1, "verified");
					await this.savePluginData();
					new Notice(`发布并验证完成：${file.basename}`);
				} catch (error) {
					this.recordTask(
						project.id, startedAt,
						error instanceof PublisherError && error.code === "AMBIGUOUS_WRITE" ? "remote-state-unknown" : "failed",
						0, 1, error instanceof PublisherError ? error.stage : "publish",
						error,
					);
					await this.savePluginData();
					throw error;
				}
			} : undefined).open();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "预览失败。");
		}
	}

	private async showTreePreview(
		project: PublishProject,
		mode: "quick" | "refreshed",
		allowPublish: boolean,
	): Promise<void> {
		if (mode === "refreshed" && !this.canUseRemote(project)) {
			new Notice("请先测试当前 Token，并确认它可以访问该项目的腾讯文档。");
			return;
		}
		try {
			const repository = new ObsidianLocalPageRepository(this.app.vault, this.app.metadataCache);
			const reader = new ObsidianVaultReader(this.app.vault, this.app.metadataCache);
			let prepared: ProjectPreflight;
			if (mode === "refreshed") {
				prepared = await prepareProjectPreflight(project, repository, reader, this.createClient(), this.data);
			} else {
				const localTree = await discoverLocalPageTree(repository, project.sourceRootPath, {
					allowedRootPath: project.allowedRootPath,
					maxDepth: project.maxDepth,
					maxNotes: project.maxNotes,
					embeddedMarkdownAsPage: project.embeddedMarkdownAsPage ?? this.data.defaults.embeddedMarkdownAsPage,
				});
				const nodes = [localTree.root, ...localTree.root.children.flatMap(function flatten(node): typeof localTree.root[] {
					return [node, ...node.children.flatMap(flatten)];
				})];
				const pages = [];
				for (const node of nodes) pages.push(await preflightPage(reader, project, node.path, "quick", undefined, this.data.remoteTreeCaches[project.id], project.embeddedMarkdownAsPage ?? this.data.defaults.embeddedMarkdownAsPage));
				prepared = {
					project,
					localTree,
					pages,
					blockers: [],
					budget: { pageReadsAtLeast: 0, pageWritesAtLeast: 0, uniqueImages: 0, changedPdfs: 0 },
				};
			}
			const summary = mode === "refreshed"
				? `预计至少读取 ${prepared.budget.pageReadsAtLeast} 次、写入 ${prepared.budget.pageWritesAtLeast} 页；上传 ${prepared.budget.uniqueImages} 张去重图片，导入 ${prepared.budget.changedPdfs} 个 PDF。`
				: undefined;
			new PreviewModal(this.app, prepared.pages, mode, allowPublish ? async () => {
				const progress = new ProgressModal(this.app);
				progress.open();
				const startedAt = new Date().toISOString();
				try {
					const result = await executeProjectPublish(
					prepared,
					reader,
					this.createClient(),
					this.data,
					uploadBinary,
					{
						signal: progress.controller.signal,
						saveState: () => this.savePluginData(),
						onProgress: (state) => progress.update(state),
					},
				);
					this.recordTask(project.id, startedAt, result.cancelled ? "cancelled" : "completed", result.published.length, prepared.pages.length, result.cancelled ? "cancelled" : "verified");
					await this.savePluginData();
					const message = `发布完成 ${result.published.length} 页，跳过 ${result.skipped.length} 页。${result.permissions.length ? "公开权限已请求，请用未登录窗口抽查。" : ""}`;
					progress.complete(message);
					new Notice(message);
				} catch (error) {
					const completed = prepared.pages.filter((page) => {
						const publishedAt = project.pageMap[page.localPath]?.lastPublishedAt;
						return Boolean(publishedAt && publishedAt >= startedAt);
					}).length;
					this.recordTask(
						project.id, startedAt,
						error instanceof PublisherError && error.code === "AMBIGUOUS_WRITE" ? "remote-state-unknown" : "failed",
						completed, prepared.pages.length, error instanceof PublisherError ? error.stage : "publish", error,
					);
					await this.savePluginData();
					progress.complete(error instanceof Error ? error.message : "发布失败。");
					throw error;
				}
			} : undefined, summary).open();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "总览树预览失败。");
		}
	}

	private recordTask(
		projectId: string,
		startedAt: string,
		status: "completed" | "failed" | "cancelled" | "remote-state-unknown",
		completedPages: number,
		totalPages: number,
		stage: string,
		error?: unknown,
	): void {
		this.data.recentTasks.unshift({
			id: crypto.randomUUID(),
			projectId,
			startedAt,
			finishedAt: new Date().toISOString(),
			status,
			completedPages,
			totalPages,
			stage,
			...(error instanceof PublisherError && error.traceId ? { traceId: error.traceId } : {}),
			...(error instanceof Error ? { error: error.message.slice(0, 500) } : {}),
		});
		this.data.recentTasks = this.data.recentTasks.slice(0, 50);
	}
}

function stringField(record: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) if (typeof record[key] === "string" && record[key]) return record[key];
	return undefined;
}

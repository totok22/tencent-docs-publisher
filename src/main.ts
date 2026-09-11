import { Menu, Notice, Plugin, TFile, TFolder, type MenuItem } from "obsidian";
import { migrateData } from "./domain/publish-state";
import { bindingsFromSelections } from "./domain/page-binding";
import { ProjectIndex } from "./domain/project-index";
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
	DATA_SCHEMA_VERSION,
	type PublishProject,
	type TencentDocsPublisherData,
} from "./types";

export default class TencentDocsPublisherPlugin extends Plugin {
	data!: TencentDocsPublisherData;
	tokenStore!: TencentTokenStore;
	private readonly projectIndex = new ProjectIndex();

	async onload(): Promise<void> {
		const rawData: unknown = await this.loadData();
		this.data = migrateData(rawData);
		this.rebuildProjectIndex();
		this.tokenStore = new TencentTokenStore(this.app);

		if (this.data.showRibbonIcon) {
			this.addRibbonIcon("cloud-upload", "腾讯文档发布：打开发布管理", () => {
				this.openPublishManager();
			});
		}

		this.registerCommands();
		this.registerMenus();
		this.registerView(PROJECT_VIEW_TYPE, (leaf) => new ProjectView(leaf, this));
		this.addSettingTab(new TencentDocsSettingTab(this.app, this));

		// Current-version data was already normalized in memory. Rewriting a large
		// cache on every startup delays plugin availability without changing data.
		if (persistedSchemaVersion(rawData) !== DATA_SCHEMA_VERSION) {
			await this.savePluginData();
		}
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
			new Notice("请先在设置里保存 token。");
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
		const project = projectId ? this.projectIndex.projectById(projectId) : undefined;
		if (project) {
			void this.refreshAndOpenBinding(project);
			return;
		}
		const file = this.activeMarkdown();
		if (!file) {
			new Notice("请先打开一篇 Markdown 笔记。");
			return;
		}
		if (!this.tokenStore.hasToken() || !this.data.verifiedAccountId) {
			new Notice("请先在设置里保存 token 并点一次「测试连接」。");
			return;
		}
		this.openProjectSetup(file);
	}

	previewProject(projectId: string): void {
		const project = this.projectIndex.projectById(projectId);
		if (project) void this.showTreePreview(project, "quick", false);
	}

	publishProject(projectId: string): void {
		const project = this.projectIndex.projectById(projectId);
		if (project) void this.showTreePreview(project, "refreshed", true);
	}

	openProjectDocument(projectId: string): void {
		const project = this.projectIndex.projectById(projectId);
		if (project?.remoteUrl) window.open(project.remoteUrl);
	}

	async removeProject(projectId: string): Promise<void> {
		if (!window.confirm("确认移除该本地发布项目？")) return;
		this.data.projects = this.data.projects.filter((project) => project.id !== projectId);
		delete this.data.remoteTreeCaches[projectId];
		this.rebuildProjectIndex();
		await this.savePluginData();
		new Notice("已移除本地发布项目。");
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
					const project = this.projectForPath(file.path);
					const bound = Boolean(project?.pageMap[file.path]);
					if (bound) {
						this.addMenuItem(menu, "腾讯文档：发布当前笔记", "cloud-upload", () => this.publishFile(file));
						this.addMenuItem(menu, "腾讯文档：预览当前笔记", "scan-eye", () => this.previewFile(file));
						if (project) this.addMenuItem(menu, "腾讯文档：发布文档树", "folder-tree", () => this.publishProject(project.id));
					} else {
						this.addMenuItem(menu, "腾讯文档：新建发布项目…", "folder-tree", () => this.openProjectSetup(file));
					}
					if (project) {
						this.addMenuItem(menu, "腾讯文档：页面绑定…", "link", () => this.openBindingManager(project.id));
						this.addMenuItem(menu, "腾讯文档：在腾讯文档中打开", "external-link", () => this.openRemoteForFile(file));
					}
				} else if (file instanceof TFolder) {
					const project = this.projectIndex.projectForAllowedRoot(file.path);
					this.addMenuItem(menu, "腾讯文档：新建发布项目…", "folder-tree", () => this.createProjectFromFolder(file));
					if (project) {
						this.addMenuItem(menu, "腾讯文档：发布项目", "cloud-upload", () => this.publishProject(project.id));
						this.addMenuItem(menu, "腾讯文档：预览项目", "scan-eye", () => this.previewProject(project.id));
						this.addMenuItem(menu, "腾讯文档：刷新页面树与绑定", "refresh-cw", () => this.openBindingManager(project.id));
					}
				}
			}),
		);
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu: Menu) => {
				const file = this.activeMarkdown();
				if (!file) return;
				if (!this.projectForPath(file.path)?.pageMap[file.path]) return;
				this.addMenuItem(menu, "腾讯文档：检查并发布这篇笔记", "cloud-upload", () => this.publishFile(file));
				this.addMenuItem(menu, "腾讯文档：只看这篇笔记的变化", "scan-eye", () => this.previewFile(file));
			}),
		);
	}

	private addMenuItem(menu: Menu, title: string, icon: string, action: () => void): void {
		menu.addItem((item: MenuItem) => item.setTitle(title).setIcon(icon).setSection("tencent-docs").onClick(action));
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
		return this.projectIndex.projectForPath(path);
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
			new Notice("这篇笔记还没有绑定腾讯页面，请先用「页面绑定」完成绑定。");
			return;
		}
		if (!project.remoteUrl) {
			new Notice("这个项目还没有记录腾讯文档地址，请先执行一次「刷新远端页面树与绑定」。");
			return;
		}
		window.open(project.remoteUrl);
		const title = project.pageMap[file.path]?.remoteTitle;
		if (title) new Notice(`已在腾讯文档中打开；这篇笔记对应的是子页面「${title}」。`);
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
		this.rebuildProjectIndex();
		try {
			await this.refreshAndOpenBinding(project);
		} catch (error) {
			this.data.projects = this.data.projects.filter((item) => item.id !== project.id);
			this.rebuildProjectIndex();
			throw error;
		}
	}

	private openProjectSetup(file: TFile): void {
		if (!this.tokenStore.hasToken() || !this.data.verifiedAccountId) {
			new Notice("请先在设置里保存 token 并点一次「测试连接」。");
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
		const loading = new Notice("正在读取本地与腾讯文档页面树…", 0);
		await yieldToUi();
		try {
			const repository = new ObsidianLocalPageRepository(this.app.vault, this.app.metadataCache);
			const result = await refreshBindings(project, repository, this.createClient(), project.embeddedMarkdownAsPage ?? this.data.defaults.embeddedMarkdownAsPage);
			this.data.remoteTreeCaches[project.id] = result.cache;
			if (result.remoteUrl) project.remoteUrl = result.remoteUrl;
			const rootId = result.proposals[0]?.remotePageId;
			if (rootId) project.remoteRootPageId = rootId;
			new BindingModal(this.app, result.proposals, result.cache.nodes, async (selections) => {
				project.pageMap = bindingsFromSelections(result.proposals, selections, result.cache.nodes, project.pageMap);
				this.rebuildProjectIndex();
				await this.savePluginData();
				new Notice("绑定已保存。");
			}).open();
			await this.savePluginData();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "无法刷新远端页面树。");
			throw error;
		} finally {
			loading.hide();
		}
	}

	private async showPagePreview(file: TFile, mode: "quick" | "refreshed", allowPublish: boolean): Promise<void> {
		const project = this.projectForPath(file.path);
		if (!project) {
			new Notice("这篇笔记还没有发布项目。请先在文件上右键选择「用这篇笔记新建发布项目」。");
			return;
		}
		if (mode === "refreshed" && !this.canUseRemote(project)) {
			new Notice("需要先确认 token 可用：请在设置里点一次「测试连接」。");
			return;
		}
		const loading = new Notice(mode === "refreshed" ? "正在读取并检查页面…" : "正在生成本地预览…", 0);
		await yieldToUi();
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
			new PreviewModal(this.app, [preview], mode, allowPublish ? async (requested) => {
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
					const allowConflict = requested.length > 0 || !this.data.defaults.stopOnConflict;
					const published = await publishPreparedPage(publishClient, project, preview, mdx, allowConflict);
					this.recordTask(project.id, startedAt, "completed", 1, 1, "verified");
					await this.savePluginData();
					const extra = published.warnings.length ? `注意：${published.warnings.join(" ")}` : "";
					new Notice(`已发布并回读校验：${file.basename}。${extra}`);
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
			new Notice(error instanceof Error ? error.message : "无法生成预览。");
		} finally {
			loading.hide();
		}
	}

	private async showTreePreview(
		project: PublishProject,
		mode: "quick" | "refreshed",
		allowPublish: boolean,
	): Promise<void> {
		if (mode === "refreshed" && !this.canUseRemote(project)) {
			new Notice("需要先确认 token 可用：请在设置里点一次「测试连接」。");
			return;
		}
		const loading = new Notice(mode === "refreshed" ? "正在读取并检查文档树…" : "正在生成本地文档树预览…", 0);
		await yieldToUi();
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
				? this.summarizePreflight(prepared)
				: "离线预览";
			new PreviewModal(this.app, prepared.pages, mode, allowPublish ? async (requested) => {
				const progress = new ProgressModal(this.app);
				progress.open();
				const startedAt = new Date().toISOString();
				try {
					const allowConflicts = new Set(requested);
					if (!this.data.defaults.stopOnConflict) {
						for (const page of prepared.pages) if (page.status === "conflict") allowConflicts.add(page.localPath);
					}
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
						allowConflicts,
					},
				);
					this.recordTask(project.id, startedAt, result.cancelled ? "cancelled" : "completed", result.published.length, prepared.pages.length, result.cancelled ? "cancelled" : "verified");
					await this.savePluginData();
					const reasons = [...new Set(Object.values(result.skipReasons))];
					const notices = [...new Set(Object.values(result.pageWarnings).flat())];
					const message = [
						`发布完成：已更新 ${result.published.length} 页，跳过 ${result.skipped.length} 页。`,
						...reasons,
						...notices,
						result.permissions.length ? "已请求公开只读权限，建议用未登录窗口抽查一次。" : "",
					].filter(Boolean).join(" ");
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
			new Notice(error instanceof Error ? error.message : "无法生成发布预览。");
		} finally {
			loading.hide();
		}
	}

	private rebuildProjectIndex(): void {
		this.projectIndex.rebuild(this.data.projects);
	}

	/** 把预检预算翻译成一句人话，说明这次发布会做什么。 */
	private summarizePreflight(prepared: ProjectPreflight): string {
		const pending = prepared.pages.filter((page) => page.status === "changed").length;
		const conflicts = prepared.pages.filter((page) => page.status === "conflict").length;
		const bound = prepared.pages.length - prepared.pages.filter((page) => page.status === "unbound").length;
		const parts: string[] = [];
		if (prepared.budget.pageWritesAtLeast > 0) parts.push(`将更新 ${prepared.budget.pageWritesAtLeast} 个页面`);
		else parts.push("没有需要更新的页面");
		if (prepared.budget.uniqueImages > 0) parts.push(`上传 ${prepared.budget.uniqueImages} 张图片`);
		if (prepared.budget.changedPdfs > 0) parts.push(`导入 ${prepared.budget.changedPdfs} 个 PDF`);
		if (conflicts > 0) parts.push(`${conflicts} 个页面需要确认覆盖`);
		parts.push(`共读取 ${prepared.budget.pageReadsAtLeast} 次远端内容（${pending}/${bound} 页有本地改动）`);
		return parts.join("；") + "。";
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

function persistedSchemaVersion(raw: unknown): number | null {
	return typeof raw === "object" && raw !== null && !Array.isArray(raw) &&
		typeof (raw as Record<string, unknown>).schemaVersion === "number"
		? (raw as Record<string, unknown>).schemaVersion as number
		: null;
}

function yieldToUi(): Promise<void> {
	const targetWindow = window.activeWindow;
	return new Promise((resolve) => targetWindow.requestAnimationFrame(() => {
		targetWindow.requestAnimationFrame(() => resolve());
	}));
}

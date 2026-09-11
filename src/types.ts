export const DATA_SCHEMA_VERSION = 1;
export const TENCENT_MCP_ENDPOINT = "https://docs.qq.com/openapi/mcp";
export const TENCENT_TOKEN_URL = "https://docs.qq.com/scenario/open-claw.html?nlc=1";
export const TOKEN_SECRET_ID = "tencent-docs-publisher-token";

export interface RemotePageBinding {
	pageId: string;
	parentPageId: string | null;
	localTitle: string;
	remoteTitle: string;
	lastPublishedSourceHash?: string;
	lastPublishedRemoteHash?: string;
	lastPublishedAt?: string;
}

export interface PublishProject {
	schemaVersion: number;
	id: string;
	accountId: string;
	sourceRootPath: string;
	allowedRootPath: string;
	remoteFileId: string;
	remoteUrl: string;
	remoteRootPageId: string;
	publicRead: boolean;
	embeddedMarkdownAsPage?: boolean;
	maxDepth: number;
	maxNotes: number;
	pageMap: Record<string, RemotePageBinding>;
	accountConfirmationRequired?: boolean;
}

export interface RemotePageNode {
	pageId: string;
	parentPageId: string | null;
	title: string;
	childPageIds: string[];
	contentFingerprint: string;
}

export interface RemoteTreeCache {
	projectId: string;
	fetchedAt: string;
	nodes: Record<string, RemotePageNode>;
}

export interface ImportedPdfState {
	sourcePath: string;
	contentHash: string;
	fileId: string;
	fileUrl: string;
	orphanedFileIds: string[];
}

export type TaskStatus = "completed" | "failed" | "cancelled" | "remote-state-unknown";

export interface PublishTaskRecord {
	id: string;
	projectId: string;
	startedAt: string;
	finishedAt: string;
	status: TaskStatus;
	completedPages: number;
	totalPages: number;
	stage: string;
	traceId?: string;
	error?: string;
}

export interface PublisherDefaults {
	publicRead: boolean;
	embeddedMarkdownAsPage: boolean;
	maxDepth: number;
	maxNotes: number;
	stopOnConflict: boolean;
	skipUnchanged: boolean;
}

export interface TencentDocsPublisherData {
	schemaVersion: number;
	showRibbonIcon: boolean;
	defaults: PublisherDefaults;
	verifiedAccountId: string | null;
	projects: PublishProject[];
	remoteTreeCaches: Record<string, RemoteTreeCache>;
	importedPdfs: Record<string, ImportedPdfState>;
	recentTasks: PublishTaskRecord[];
}

export const DEFAULT_DATA: TencentDocsPublisherData = {
	schemaVersion: DATA_SCHEMA_VERSION,
	showRibbonIcon: true,
	defaults: {
		publicRead: false,
		embeddedMarkdownAsPage: false,
		maxDepth: 8,
		maxNotes: 200,
		stopOnConflict: true,
		skipUnchanged: true,
	},
	verifiedAccountId: null,
	projects: [],
	remoteTreeCaches: {},
	importedPdfs: {},
	recentTasks: [],
};

export const COMMAND_IDS = {
	publishCurrentPage: "publish-current-page",
	previewCurrentPage: "preview-current-page",
	publishCurrentTree: "publish-current-overview-tree",
	previewCurrentTree: "preview-current-overview-tree",
	manageBinding: "create-or-manage-binding",
	refreshRemoteTree: "refresh-remote-page-tree",
	openRemoteDocument: "open-corresponding-remote-document",
	openPublishManager: "open-publish-manager",
} as const;

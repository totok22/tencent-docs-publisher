export interface TencentDocsPublisherSettings {
	mcpServerUrl: string;
	defaultSpaceId: string;
	autoSyncOnSave: boolean;
	showRibbonIcon: boolean;
	logLevel: "debug" | "info" | "warn" | "error";
	mappings: DocMapping[];
}

export interface DocMapping {
	id: string;
	sourcePath: string; // vault relative path
	targetFileId: string;
	targetTitle?: string;
	lastPublishedAt?: number;
	lastPublishedHash?: string;
}

export const DEFAULT_SETTINGS: TencentDocsPublisherSettings = {
	mcpServerUrl: "http://localhost:3000",
	defaultSpaceId: "",
	autoSyncOnSave: false,
	showRibbonIcon: true,
	logLevel: "info",
	mappings: []
};

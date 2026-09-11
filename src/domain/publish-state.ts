import { DATA_SCHEMA_VERSION, DEFAULT_DATA, type TencentDocsPublisherData } from "../types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Migrate persisted data and reject unknown future versions before any save. */
export function migrateData(raw: unknown): TencentDocsPublisherData {
	if (!isRecord(raw) || Object.keys(raw).length === 0) {
		return structuredClone(DEFAULT_DATA);
	}

	const version = typeof raw.schemaVersion === "number" ? raw.schemaVersion : 0;
	if (version > DATA_SCHEMA_VERSION) {
		throw new Error(
			`数据版本 ${version} 高于插件支持的 ${DATA_SCHEMA_VERSION}，已停止加载以避免覆盖新版本数据。`,
		);
	}

	if (version === 0) {
		return {
			...structuredClone(DEFAULT_DATA),
			showRibbonIcon:
				typeof raw.showRibbonIcon === "boolean" ? raw.showRibbonIcon : DEFAULT_DATA.showRibbonIcon,
		};
	}

	return normalizeCurrent(raw);
}

function normalizeCurrent(raw: Record<string, unknown>): TencentDocsPublisherData {
	const defaults = isRecord(raw.defaults) ? raw.defaults : {};
	return {
		schemaVersion: DATA_SCHEMA_VERSION,
		showRibbonIcon: booleanOr(raw.showRibbonIcon, DEFAULT_DATA.showRibbonIcon),
		defaults: {
			publicRead: booleanOr(defaults.publicRead, DEFAULT_DATA.defaults.publicRead),
			embeddedMarkdownAsPage: booleanOr(
				defaults.embeddedMarkdownAsPage,
				DEFAULT_DATA.defaults.embeddedMarkdownAsPage,
			),
			maxDepth: boundedInteger(defaults.maxDepth, DEFAULT_DATA.defaults.maxDepth, 1, 32),
			maxNotes: boundedInteger(defaults.maxNotes, DEFAULT_DATA.defaults.maxNotes, 1, 2_000),
			stopOnConflict: booleanOr(defaults.stopOnConflict, DEFAULT_DATA.defaults.stopOnConflict),
			skipUnchanged: booleanOr(defaults.skipUnchanged, DEFAULT_DATA.defaults.skipUnchanged),
		},
		verifiedAccountId: typeof raw.verifiedAccountId === "string" ? raw.verifiedAccountId : null,
		projects: Array.isArray(raw.projects) ? (raw.projects as TencentDocsPublisherData["projects"]) : [],
		remoteTreeCaches: isRecord(raw.remoteTreeCaches)
			? (raw.remoteTreeCaches as TencentDocsPublisherData["remoteTreeCaches"])
			: {},
		importedPdfs: isRecord(raw.importedPdfs)
			? (raw.importedPdfs as TencentDocsPublisherData["importedPdfs"])
			: {},
		recentTasks: Array.isArray(raw.recentTasks)
			? (raw.recentTasks as TencentDocsPublisherData["recentTasks"]).slice(0, 50)
			: [],
	};
}

function booleanOr(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
	return typeof value === "number" && Number.isInteger(value)
		? Math.max(min, Math.min(max, value))
		: fallback;
}

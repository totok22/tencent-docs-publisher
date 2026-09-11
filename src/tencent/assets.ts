import SparkMD5 from "spark-md5";
import type { PreparedAsset, PreflightVaultReader } from "../application/preflight";
import type { ImportedPdfState } from "../types";
import type { ToolJsonCaller } from "./smartcanvas";

export interface AssetResolution {
	urls: Record<number, string>;
	referencedPdfFileIds: string[];
}

export type BinaryUploader = (url: string, body: ArrayBuffer) => Promise<void>;

export class PublishAssetResolver {
	private readonly imageByHash = new Map<string, string>();

	constructor(
		private readonly client: ToolJsonCaller,
		private readonly reader: PreflightVaultReader,
		private readonly pdfStates: Record<string, ImportedPdfState>,
		private readonly upload: BinaryUploader,
		private readonly delay: (milliseconds: number) => Promise<void> = defaultDelay,
	) {}

	async resolve(assets: PreparedAsset[], signal?: AbortSignal): Promise<AssetResolution> {
		const urls: Record<number, string> = {};
		const referencedPdfFileIds: string[] = [];
		for (const asset of assets) {
			if (signal?.aborted) throw new Error("发布已取消。");
			if (!asset.resolvedPath) throw new Error(`资源无法解析：${asset.target}`);
			const bytes = await this.reader.readBinary(asset.resolvedPath);
			if (asset.kind === "image") {
				urls[asset.index] = await this.uploadImage(asset, bytes);
			} else {
				const pdf = await this.importPdf(asset, bytes, signal);
				urls[asset.index] = pdf.fileUrl;
				referencedPdfFileIds.push(pdf.fileId);
			}
		}
		return { urls, referencedPdfFileIds };
	}

	private async uploadImage(asset: PreparedAsset, bytes: ArrayBuffer): Promise<string> {
		const cached = this.imageByHash.get(asset.contentHash);
		if (cached) return cached;
		const response = await this.client.callToolJson<Record<string, unknown>>("upload_image", {
			file_name: filename(asset.resolvedPath ?? asset.target),
			image_base64: arrayBufferToBase64(bytes),
		}, "upload-image");
		const url = firstString(response, ["image_id", "image_url", "url"]);
		if (!url) throw new Error("图片上传成功响应缺少 image_id。");
		this.imageByHash.set(asset.contentHash, url);
		return url;
	}

	private async importPdf(asset: PreparedAsset, bytes: ArrayBuffer, signal?: AbortSignal): Promise<ImportedPdfState> {
		const key = asset.resolvedPath ?? asset.target;
		const cached = this.pdfStates[key];
		if (cached?.contentHash === asset.contentHash) return cached;
		const name = filename(key);
		const pre = await this.client.callToolJson<Record<string, unknown>>("manage.pre_import", {
			file_name: name,
			file_size: bytes.byteLength,
			file_md5: SparkMD5.ArrayBuffer.hash(bytes),
		}, "pre-import-pdf");
		const uploadUrl = firstString(pre, ["upload_url"]);
		const taskId = firstString(pre, ["task_id"]);
		const fileKey = firstString(pre, ["file_key"]);
		if (!uploadUrl || !taskId || !fileKey) throw new Error("PDF 预导入响应不完整。");
		await this.upload(uploadUrl, bytes);
		const kicked = await this.client.callToolJson<Record<string, unknown>>("manage.async_import", {
			task_id: taskId,
			file_key: fileKey,
			file_name: name,
			file_md5: SparkMD5.ArrayBuffer.hash(bytes),
			file_size: bytes.byteLength,
		}, "start-import-pdf");
		const activeTaskId = firstString(kicked, ["task_id"]) ?? taskId;
		for (let attempt = 0; attempt < 45; attempt += 1) {
			if (signal?.aborted) throw new Error("发布已取消。");
			await this.delay(4_000);
			const progress = await this.client.callToolJson<Record<string, unknown>>("manage.import_progress", {
				task_id: activeTaskId,
			}, "poll-import-pdf");
			const fileUrl = firstString(progress, ["file_url", "url"]);
			const fileId = firstString(progress, ["file_id"]);
			if (fileUrl && fileId) {
				const next: ImportedPdfState = {
					sourcePath: key,
					contentHash: asset.contentHash,
					fileId,
					fileUrl,
					orphanedFileIds: [...(cached?.orphanedFileIds ?? []), ...(cached ? [cached.fileId] : [])],
				};
				this.pdfStates[key] = next;
				return next;
			}
			if (progress.error || progress.status === "failed") throw new Error("PDF 导入失败。");
		}
		throw new Error(`PDF 导入超时：${name}`);
	}
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	for (let offset = 0; offset < bytes.length; offset += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
	}
	return btoa(binary);
}

function filename(path: string): string {
	return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) if (typeof record[key] === "string" && record[key]) return record[key];
	return undefined;
}

function defaultDelay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => (typeof window !== "undefined" ? window.setTimeout : setTimeout)(resolve, milliseconds));
}

import type { ToolJsonCaller } from "./smartcanvas";

export interface PermissionRequestResult {
	fileId: string;
	requested: boolean;
	error?: string;
}

export async function requestPublicRead(
	client: ToolJsonCaller,
	fileIds: string[],
): Promise<PermissionRequestResult[]> {
	const results: PermissionRequestResult[] = [];
	for (const fileId of [...new Set(fileIds)]) {
		try {
			await client.callToolJson("manage.set_privilege", { file_id: fileId, policy: 2 }, "request-public-read");
			results.push({ fileId, requested: true });
		} catch (error) {
			results.push({ fileId, requested: false, error: error instanceof Error ? error.message : "权限请求失败。" });
		}
	}
	return results;
}

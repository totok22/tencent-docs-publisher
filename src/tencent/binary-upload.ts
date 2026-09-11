import { requestUrl } from "obsidian";

export async function uploadBinary(url: string, body: ArrayBuffer): Promise<void> {
	const response = await requestUrl({ url, method: "PUT", body, throw: false });
	if (response.status < 200 || response.status >= 300) throw new Error(`资源上传返回 HTTP ${response.status}。`);
}

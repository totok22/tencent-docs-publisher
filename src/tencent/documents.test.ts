import { describe, expect, it } from "vitest";
import { findSmartcanvasDocuments } from "./documents";

describe("Tencent document discovery", () => {
	it("continues through recent pages after filtering non-smartcanvas files", async () => {
		const requestedPages: number[] = [];
		const client = {
			async callToolJson<T>(name: string, args?: Record<string, unknown>): Promise<T> {
				expect(name).toBe("manage.recent_online_file");
				const page = Number(args?.num);
				requestedPages.push(page);
				if (page === 1) return { files: [
					...Array.from({ length: 17 }, (_, index) => recent(`sheet-${index}`, "sheet")),
					recent("smart-1", "aio"), recent("smart-2", "aio"), recent("smart-3", "aio"),
				] } as T;
				if (page === 2) return { files: [recent("smart-4", "aio"), recent("smart-5", "aio")] } as T;
				throw new Error(`unexpected page ${page}`);
			},
		};
		const result = await findSmartcanvasDocuments(client);
		expect(result.map((choice) => choice.fileId)).toEqual(["smart-1", "smart-2", "smart-3", "smart-4", "smart-5"]);
		expect(requestedPages).toEqual([1, 2]);
	});

	it("uses type hints and falls back to file info only for unknown results", async () => {
		const calls: string[] = [];
		const client = {
			async callToolJson<T>(name: string): Promise<T> {
				calls.push(name);
				if (name === "manage.search_file") return { list: [
					{ file_id: "known", title: "Known", ext: "smartcanvas", url: "https://docs.qq.com/aio/known" },
					{ file_id: "sheet", title: "Sheet", ext: "tencentsheet" },
					{ file_id: "unknown", title: "Unknown" },
				] } as T;
				return { type: "smartcanvas", title: "Verified", url: "https://docs.qq.com/aio/unknown" } as T;
			},
		};
		const result = await findSmartcanvasDocuments(client, "test");
		expect(result.map((choice) => choice.title)).toEqual(["Known", "Verified"]);
		expect(calls).toEqual(["manage.search_file", "manage.query_file_info"]);
	});
});

function recent(id: string, kind: string): Record<string, string> {
	return { file_id: id, file_name: id, file_url: `https://docs.qq.com/${kind}/${id}` };
}

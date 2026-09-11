export async function sha256Hex(input: string | ArrayBuffer): Promise<string> {
	const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizeSemanticWhitespace(input: string): string {
	return input
		.replace(/\r\n?/g, "\n")
		.replace(/[\t ]+(?=<\/)/g, "")
		.replace(/[\t ]+$/gm, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

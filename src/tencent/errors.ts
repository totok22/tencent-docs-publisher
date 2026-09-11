export type PublisherErrorCode =
	| "AUTH"
	| "TIMEOUT"
	| "RATE_LIMIT"
	| "QUOTA"
	| "NETWORK"
	| "PROTOCOL"
	| "REMOTE"
	| "EMPTY_SUB_PAGE"
	| "AMBIGUOUS_WRITE";

export class PublisherError extends Error {
	constructor(
		message: string,
		readonly code: PublisherErrorCode,
		readonly stage: string,
		readonly traceId?: string,
		readonly retryable = false,
	) {
		super(redact(message));
		this.name = "PublisherError";
	}
}

export function redact(message: string): string {
	return message
		.replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi, "$1[REDACTED]")
		.replace(/(token\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
		.replace(/https?:\/\/[^\s"']*(?:upload|cos|cdn)[^\s"']*/gi, "[REDACTED_URL]")
		.replace(/(?:[A-Za-z0-9+/]{80,}={0,2})/g, "[REDACTED_BASE64]")
		.slice(0, 800);
}

export function classifyHttpError(status: number, stage: string, traceId?: string): PublisherError {
	if (status === 401 || status === 403) return new PublisherError("Token 无效或没有访问权限。", "AUTH", stage, traceId);
	if (status === 429) return new PublisherError("腾讯接口触发限流。", "RATE_LIMIT", stage, traceId, true);
	if (status === 402 || status === 507) return new PublisherError("腾讯接口额度不足。", "QUOTA", stage, traceId);
	return new PublisherError(`腾讯接口返回 HTTP ${status}。`, "REMOTE", stage, traceId, status >= 500);
}

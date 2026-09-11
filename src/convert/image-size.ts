export interface ImageDimensions {
	width: number;
	height: number;
}

/**
 * 读图片的像素尺寸。Obsidian 的 `|514` 只给宽度，而腾讯文档会把你给的 width/height 原样保留，
 * 所以按同比算出高度一起写入，避免图片被拉伸。无法识别时返回 null，由调用方决定怎么处理。
 */
export function readImageDimensions(bytes: ArrayBuffer): ImageDimensions | null {
	const view = new DataView(bytes);
	if (view.byteLength < 16) return null;
	return readPng(view) ?? readGif(view) ?? readBmp(view) ?? readJpeg(view) ?? readWebp(view) ?? readSvg(bytes);
}

function readPng(view: DataView): ImageDimensions | null {
	if (view.byteLength < 24 || view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) return null;
	if (view.getUint32(12) !== 0x49484452) return null;
	return dimensions(view.getUint32(16), view.getUint32(20));
}

function readGif(view: DataView): ImageDimensions | null {
	const signature = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3), view.getUint8(4), view.getUint8(5));
	if (signature !== "GIF87a" && signature !== "GIF89a") return null;
	return dimensions(view.getUint16(6, true), view.getUint16(8, true));
}

function readBmp(view: DataView): ImageDimensions | null {
	if (view.byteLength < 26 || view.getUint8(0) !== 0x42 || view.getUint8(1) !== 0x4d) return null;
	const width = Math.abs(view.getInt32(18, true));
	const height = Math.abs(view.getInt32(22, true));
	return dimensions(width, height);
}

/** JPEG 的尺寸在 SOF 段里，需要跳过前面的段。 */
function readJpeg(view: DataView): ImageDimensions | null {
	if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
	let offset = 2;
	while (offset + 9 < view.byteLength) {
		if (view.getUint8(offset) !== 0xff) { offset += 1; continue; }
		const marker = view.getUint8(offset + 1);
		if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
		const length = view.getUint16(offset + 2);
		if (length < 2) return null;
		const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
		if (isSof) return dimensions(view.getUint16(offset + 7), view.getUint16(offset + 5));
		offset += 2 + length;
	}
	return null;
}

function readWebp(view: DataView): ImageDimensions | null {
	if (view.byteLength < 30) return null;
	if (view.getUint32(0) !== 0x52494646 || view.getUint32(8) !== 0x57454250) return null;
	const format = String.fromCharCode(view.getUint8(12), view.getUint8(13), view.getUint8(14), view.getUint8(15));
	if (format === "VP8X") {
		const width = view.getUint8(24) + (view.getUint8(25) << 8) + (view.getUint8(26) << 16) + 1;
		const height = view.getUint8(27) + (view.getUint8(28) << 8) + (view.getUint8(29) << 16) + 1;
		return dimensions(width, height);
	}
	if (format === "VP8L") {
		if (view.getUint8(20) !== 0x2f) return null;
		const b0 = view.getUint8(21);
		const b1 = view.getUint8(22);
		const b2 = view.getUint8(23);
		const b3 = view.getUint8(24);
		return dimensions(
			(b0 | ((b1 & 0x3f) << 8)) + 1,
			(((b1 >> 6) & 0x03) | (b2 << 2) | ((b3 & 0x0f) << 10)) + 1,
		);
	}
	if (format === "VP8 ") {
		if (view.getUint8(23) !== 0x9d || view.getUint8(24) !== 0x01 || view.getUint8(25) !== 0x2a) return null;
		return dimensions(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
	}
	return null;
}

/** SVG 是文本，取 viewBox 或 width/height 属性。 */
function readSvg(bytes: ArrayBuffer): ImageDimensions | null {
	const head = new TextDecoder().decode(new Uint8Array(bytes.slice(0, Math.min(bytes.byteLength, 4096))));
	if (!/<svg(?:\s|>)/i.test(head)) return null;
	const viewBox = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(head);
	if (viewBox) return dimensions(Number(viewBox[1]), Number(viewBox[2]));
	const width = /\swidth\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(head);
	const height = /\sheight\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(head);
	if (width?.[1] && height?.[1]) return dimensions(Number(width[1]), Number(height[1]));
	return null;
}

function dimensions(width: number, height: number): ImageDimensions | null {
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
	return { width: Math.round(width), height: Math.round(height) };
}


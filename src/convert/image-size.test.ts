import { describe, expect, it } from "vitest";
import { readImageDimensions } from "./image-size";

describe("readImageDimensions", () => {
	it("reads PNG, GIF, BMP, and JPEG dimensions", () => {
		expect(readImageDimensions(png(419, 92))).toEqual({ width: 419, height: 92 });
		expect(readImageDimensions(gif(320, 180))).toEqual({ width: 320, height: 180 });
		expect(readImageDimensions(bmp(640, 480))).toEqual({ width: 640, height: 480 });
		expect(readImageDimensions(jpeg(800, 600))).toEqual({ width: 800, height: 600 });
	});

	it("reads all three WebP dimension encodings", () => {
		expect(readImageDimensions(webpExtended(1024, 768))).toEqual({ width: 1024, height: 768 });
		expect(readImageDimensions(webpLossless(511, 257))).toEqual({ width: 511, height: 257 });
		expect(readImageDimensions(webpLossy(1280, 720))).toEqual({ width: 1280, height: 720 });
	});

	it("reads SVG viewBox and explicit pixel dimensions", () => {
		expect(readImageDimensions(encoded('<svg viewBox="0 0 300 125"></svg>'))).toEqual({ width: 300, height: 125 });
		expect(readImageDimensions(encoded("<svg width='640px' height='360'></svg>"))).toEqual({ width: 640, height: 360 });
	});

	it("rejects truncated, malformed, or zero-sized data", () => {
		expect(readImageDimensions(new Uint8Array([0x89, 0x50]).buffer)).toBeNull();
		expect(readImageDimensions(encoded("<svg-helper></svg-helper>"))).toBeNull();
		expect(readImageDimensions(png(0, 92))).toBeNull();
	});
});

function png(width: number, height: number): ArrayBuffer {
	const bytes = new Uint8Array(24);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
	const view = new DataView(bytes.buffer);
	view.setUint32(8, 13);
	view.setUint32(12, 0x49484452);
	view.setUint32(16, width);
	view.setUint32(20, height);
	return bytes.buffer;
}

function gif(width: number, height: number): ArrayBuffer {
	const bytes = new Uint8Array(16);
	bytes.set(new TextEncoder().encode("GIF89a"));
	const view = new DataView(bytes.buffer);
	view.setUint16(6, width, true);
	view.setUint16(8, height, true);
	return bytes.buffer;
}

function bmp(width: number, height: number): ArrayBuffer {
	const bytes = new Uint8Array(26);
	bytes.set([0x42, 0x4d]);
	const view = new DataView(bytes.buffer);
	view.setInt32(18, width, true);
	view.setInt32(22, height, true);
	return bytes.buffer;
}

function jpeg(width: number, height: number): ArrayBuffer {
	const bytes = new Uint8Array(21);
	bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]);
	const view = new DataView(bytes.buffer);
	view.setUint16(7, height);
	view.setUint16(9, width);
	return bytes.buffer;
}

function webpExtended(width: number, height: number): ArrayBuffer {
	const bytes = webp("VP8X");
	writeUint24(bytes, 24, width - 1);
	writeUint24(bytes, 27, height - 1);
	return bytes.buffer as ArrayBuffer;
}

function webpLossless(width: number, height: number): ArrayBuffer {
	const bytes = webp("VP8L");
	const widthBits = width - 1;
	const heightBits = height - 1;
	bytes[20] = 0x2f;
	bytes[21] = widthBits & 0xff;
	bytes[22] = ((widthBits >> 8) & 0x3f) | ((heightBits & 0x03) << 6);
	bytes[23] = (heightBits >> 2) & 0xff;
	bytes[24] = (heightBits >> 10) & 0x0f;
	return bytes.buffer as ArrayBuffer;
}

function webpLossy(width: number, height: number): ArrayBuffer {
	const bytes = webp("VP8 ");
	bytes.set([0x9d, 0x01, 0x2a], 23);
	const view = new DataView(bytes.buffer);
	view.setUint16(26, width, true);
	view.setUint16(28, height, true);
	return bytes.buffer as ArrayBuffer;
}

function webp(format: string): Uint8Array {
	const bytes = new Uint8Array(30);
	bytes.set(new TextEncoder().encode("RIFF"), 0);
	bytes.set(new TextEncoder().encode("WEBP"), 8);
	bytes.set(new TextEncoder().encode(format), 12);
	return bytes;
}

function writeUint24(bytes: Uint8Array, offset: number, value: number): void {
	bytes[offset] = value & 0xff;
	bytes[offset + 1] = (value >> 8) & 0xff;
	bytes[offset + 2] = (value >> 16) & 0xff;
}

function encoded(value: string): ArrayBuffer {
	return new TextEncoder().encode(value).buffer;
}

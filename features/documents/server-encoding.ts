import "@beignet/core/server-only";

export function bytesToBase64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64");
}

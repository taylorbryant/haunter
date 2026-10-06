import { z } from "zod";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	pdf: "application/pdf",
	txt: "text/plain",
	md: "text/markdown",
	csv: "text/csv",
	json: "application/json",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
export const ATTACHMENT_CONTENT_TYPES = [
	...new Set(Object.values(ATTACHMENT_TYPES)),
];

/** Only app-relative URLs identify private objects. External links are never fetched by the server. */
export function attachmentKey(url: string): string | null {
	if (!url.startsWith("/api/files/") || /[?#%\\]/.test(url)) return null;
	return url.slice("/api/files/".length);
}

export function safeAttachmentName(name: string): string {
	return (
		Array.from(name)
			.map((character) =>
				character.charCodeAt(0) < 32 ||
				character.charCodeAt(0) === 127 ||
				character === "/" ||
				character === "\\"
					? "_"
					: character,
			)
			.join("")
			.slice(0, 200) || "attachment"
	);
}

export const PageAttachmentSchema = z.object({
	blockId: z.string(),
	name: z.string(),
	caption: z.string(),
	mimeType: z.string().nullable(),
	size: z.number().nullable(),
	available: z.boolean(),
});
export const ReadAttachmentMetadataSchema = PageAttachmentSchema.extend({
	pageId: z.string().uuid(),
	truncated: z.boolean(),
});
export const ReadAttachmentOutputSchema = ReadAttachmentMetadataSchema.extend({
	text: z.string().optional(),
	data: z.string().optional(),
});

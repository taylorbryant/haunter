import type { Metadata } from "next";
import { extractDocumentSearchText } from "@/features/content/document-text";
import type { SharedPage } from "@/features/shares/schemas";

export const SHARED_PAGE_IMAGE_SIZE = { width: 1200, height: 630 };

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Keep emoji and combined characters intact when shortening preview text. */
export function truncatePreviewText(text: string, limit: number): string {
	const segments: string[] = [];
	for (const { segment } of graphemes.segment(text)) {
		if (segments.length === limit) {
			return `${segments
				.slice(0, limit - 1)
				.join("")
				.trimEnd()}…`;
		}
		segments.push(segment);
	}
	return text;
}

export function getSharedPagePreview(page: SharedPage) {
	const title = page.title.replace(/\s+/g, " ").trim() || "Untitled";
	// Only read inline text from the public projection. Never include block
	// props (file URLs, task ownership, linked page IDs) in a link preview.
	const text = extractDocumentSearchText(page.content)
		.replace(/\s+/g, " ")
		.trim();
	return {
		title,
		description: text
			? truncatePreviewText(text, 160)
			: "A page shared with you on Haunter.",
	};
}

export function createSharedPageMetadata(
	page: SharedPage,
	token: string,
	appUrl: string,
): Metadata {
	const { title, description } = getSharedPagePreview(page);
	const url = new URL(`/share/${encodeURIComponent(token)}`, appUrl);
	const imageUrl = new URL(`${url.pathname}/opengraph-image`, url);
	// Give preview clients a new image URL when the public page changes.
	imageUrl.searchParams.set("v", page.updatedAt);
	const image = {
		url: imageUrl.toString(),
		...SHARED_PAGE_IMAGE_SIZE,
		type: "image/png",
		alt: `${title} — Haunter`,
	};
	return {
		title: `${title} — Haunter`,
		description,
		alternates: { canonical: url.toString() },
		openGraph: {
			type: "article",
			siteName: "Haunter",
			title,
			description,
			url: url.toString(),
			modifiedTime: page.updatedAt,
			images: [image],
		},
		twitter: {
			card: "summary_large_image",
			title,
			description,
			images: [image],
		},
	};
}

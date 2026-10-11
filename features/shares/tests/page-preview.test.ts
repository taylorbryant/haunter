import { describe, expect, it } from "bun:test";
import {
	createSharedPageMetadata,
	getSharedPagePreview,
	truncatePreviewText,
} from "@/features/shares/lib/page-preview";
import type { SharedPage } from "@/features/shares/schemas";

const page: SharedPage = {
	title: "  Weekend\nideas  ",
	icon: "🌱",
	content: [
		{
			id: "paragraph",
			type: "paragraph",
			props: {},
			content: [
				{ type: "text", text: "A small " },
				{
					type: "link",
					href: "https://example.test/private-url",
					content: [{ type: "text", text: "idea." }],
				},
			],
			children: [
				{
					id: "task",
					type: "task",
					props: { assignedTo: "private-user-id" },
					content: [{ type: "text", text: "\n  Make it happen.  " }],
					children: [],
				},
			],
		},
		{
			id: "attachment",
			type: "file",
			props: { url: "https://example.test/private-file" },
			children: [],
		},
	],
	updatedAt: "2026-10-10T12:00:00.000Z",
};

describe("public page previews", () => {
	it("uses visible inline text, excluding link targets and block properties", () => {
		expect(getSharedPagePreview(page)).toEqual({
			title: "Weekend ideas",
			description: "A small idea. Make it happen.",
		});
	});

	it("provides useful defaults for untitled and textless pages", () => {
		expect(getSharedPagePreview({ ...page, title: "  ", content: [] })).toEqual(
			{
				title: "Untitled",
				description: "A page shared with you on Haunter.",
			},
		);
	});

	it("bounds excerpts without splitting emoji sequences or combining marks", () => {
		const text = `${"a".repeat(158)}👩🏽‍💻e\u0301 too long`;
		const preview = getSharedPagePreview({
			...page,
			content: [
				{
					id: "text",
					type: "paragraph",
					props: {},
					children: [],
					content: [{ text }],
				},
			],
		});
		expect(preview.description).toBe(`${"a".repeat(158)}👩🏽‍💻…`);
		expect(truncatePreviewText("e\u0301👩🏽‍💻ab", 3)).toBe("e\u0301👩🏽‍💻…");
	});

	it("uses canonical absolute URLs and versions the image when content changes", () => {
		const metadata = createSharedPageMetadata(
			page,
			"public-token",
			"https://haunter.app",
		);
		expect(metadata.title).toBe("Weekend ideas — Haunter");
		expect(metadata.alternates?.canonical).toBe(
			"https://haunter.app/share/public-token",
		);
		expect(metadata.openGraph).toMatchObject({
			title: "Weekend ideas",
			description: "A small idea. Make it happen.",
			url: "https://haunter.app/share/public-token",
			images: [
				{
					url: "https://haunter.app/share/public-token/opengraph-image?v=2026-10-10T12%3A00%3A00.000Z",
					width: 1200,
					height: 630,
					alt: "Weekend ideas — Haunter",
				},
			],
		});
		expect(metadata.twitter).toMatchObject({
			card: "summary_large_image",
			images: metadata.openGraph?.images,
		});
		const edited = createSharedPageMetadata(
			{ ...page, updatedAt: "2026-10-11T12:00:00.000Z" },
			"public-token",
			"https://haunter.app",
		);
		expect(edited.openGraph?.images).not.toEqual(metadata.openGraph?.images);
	});
});

import { describe, expect, test } from "bun:test";
import {
	type BlockJson,
	CreatePageInputSchema,
	MAX_INITIAL_PAGE_CONTENT_BLOCKS,
	MAX_INITIAL_PAGE_CONTENT_BYTES,
	MAX_INITIAL_PAGE_CONTENT_DEPTH,
	PAGE_TITLE_MAX_LENGTH,
	PAGE_TITLE_TOO_LONG_MESSAGE,
	SavePageContentBodySchema,
	UpdatePageBodySchema,
} from "@/features/pages/schemas";

describe("page title validation", () => {
	test("accepts a title at the documented limit", () => {
		const result = UpdatePageBodySchema.safeParse({
			title: "a".repeat(PAGE_TITLE_MAX_LENGTH),
		});

		expect(result.success).toBe(true);
	});

	test("returns a user-facing error above the limit", () => {
		const result = CreatePageInputSchema.safeParse({
			workspaceId: "workspace-1",
			title: "a".repeat(PAGE_TITLE_MAX_LENGTH + 1),
		});

		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.error.issues[0]?.message).toBe(PAGE_TITLE_TOO_LONG_MESSAGE);
	});
});

describe("page write boundaries", () => {
	test("rejects legacy whole-document autosave payloads", () => {
		const result = SavePageContentBodySchema.safeParse({
			content: [],
			baseUpdatedAt: new Date().toISOString(),
		});

		expect(result.success).toBe(false);
	});

	test("requires title and metadata changes to use separate writes", () => {
		const result = UpdatePageBodySchema.safeParse({
			title: "Renamed",
			icon: "👻",
		});

		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.error.issues[0]?.message).toBe(
			"Update the title separately from the icon or page placement.",
		);
	});

	test("allows metadata fields to remain atomic in one write", () => {
		expect(
			UpdatePageBodySchema.safeParse({
				icon: "👻",
				parentPageId: crypto.randomUUID(),
				position: 2,
			}).success,
		).toBe(true);
	});
});

function paragraph(id: string, text = "Text"): BlockJson {
	return {
		id,
		type: "paragraph",
		props: {},
		content: [{ type: "text", text, styles: {} }],
		children: [],
	};
}

describe("initial page content limits", () => {
	test("rejects an oversized initial document", () => {
		const result = CreatePageInputSchema.safeParse({
			workspaceId: "workspace-1",
			title: "Oversized",
			initialContent: [
				paragraph("large", "a".repeat(MAX_INITIAL_PAGE_CONTENT_BYTES)),
			],
		});

		expect(result.success).toBe(false);
	});

	test("counts JSON escaping toward the initial document byte limit", () => {
		const result = CreatePageInputSchema.safeParse({
			workspaceId: "workspace-1",
			title: "Escaped content",
			initialContent: [
				paragraph(
					"escaped",
					'"'.repeat(Math.ceil(MAX_INITIAL_PAGE_CONTENT_BYTES / 2)),
				),
			],
		});

		expect(result.success).toBe(false);
	});

	test("rejects too many initial blocks without reading the remainder", () => {
		let readPastLimit = false;
		const blocks = Array.from(
			{ length: MAX_INITIAL_PAGE_CONTENT_BLOCKS + 2 },
			(_, index) => paragraph(`block-${index}`),
		);
		Object.defineProperty(blocks, MAX_INITIAL_PAGE_CONTENT_BLOCKS + 1, {
			get() {
				readPastLimit = true;
				return paragraph("past-limit");
			},
		});
		const result = CreatePageInputSchema.safeParse({
			workspaceId: "workspace-1",
			title: "Too many blocks",
			initialContent: blocks,
		});

		expect(result.success).toBe(false);
		expect(readPastLimit).toBe(false);
	});

	test("stops reading an inline array once the byte limit is exceeded", () => {
		let readPastLimit = false;
		const content: unknown[] = [
			"a".repeat(MAX_INITIAL_PAGE_CONTENT_BYTES),
			null,
		];
		Object.defineProperty(content, 1, {
			get() {
				readPastLimit = true;
				return null;
			},
		});
		const block = paragraph("large-inline");
		block.content = content;

		const result = CreatePageInputSchema.safeParse({
			workspaceId: "workspace-1",
			title: "Oversized inline content",
			initialContent: [block],
		});

		expect(result.success).toBe(false);
		expect(readPastLimit).toBe(false);
	});

	test("rejects excessive initial block nesting before recursive parsing", () => {
		let content = paragraph("leaf");
		for (let depth = 0; depth < MAX_INITIAL_PAGE_CONTENT_DEPTH; depth += 1) {
			const parent = paragraph(`parent-${depth}`);
			parent.children = [content];
			content = parent;
		}

		const result = CreatePageInputSchema.safeParse({
			workspaceId: "workspace-1",
			title: "Too deep",
			initialContent: [content],
		});

		expect(result.success).toBe(false);
	});
});

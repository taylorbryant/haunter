import { describe, expect, it } from "bun:test";
import {
	isMarkdownFilename,
	MarkdownImportError,
	markdownFilenameForPage,
	pageTitleFromMarkdownFilename,
	parseMarkdownPage,
} from "@/features/pages/client/markdown-files";
import { MAX_INITIAL_PAGE_CONTENT_BLOCKS } from "@/features/pages/schemas";

describe("Markdown file helpers", () => {
	it("recognizes Markdown extensions case-insensitively", () => {
		expect(isMarkdownFilename("notes.md")).toBe(true);
		expect(isMarkdownFilename("Notes.MARKDOWN")).toBe(true);
		expect(isMarkdownFilename("notes.txt")).toBe(false);
	});

	it("derives page titles from filenames", () => {
		expect(pageTitleFromMarkdownFilename("Weekly review.md")).toBe(
			"Weekly review",
		);
		expect(pageTitleFromMarkdownFilename(".md")).toBe("Imported page");
		expect(pageTitleFromMarkdownFilename(`${"a".repeat(400)}.md`)).toHaveLength(
			300,
		);
	});

	it("creates safe download filenames", () => {
		expect(markdownFilenameForPage("Sprint: 1/2? *Review*")).toBe(
			"Sprint- 1-2- -Review-.md",
		);
		expect(markdownFilenameForPage("   ")).toBe("Untitled.md");
	});

	it("stops parsing imports that exceed the server block limit", () => {
		const markdown = Array.from(
			{ length: MAX_INITIAL_PAGE_CONTENT_BLOCKS + 1 },
			(_, index) => `Paragraph ${index}`,
		).join("\n");

		expect(() => parseMarkdownPage(markdown)).toThrow(MarkdownImportError);
		expect(() => parseMarkdownPage(markdown)).toThrow("at most 10,000 blocks");
	});
});

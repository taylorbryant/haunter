import {
	blocksToMarkdown,
	MarkdownBlockLimitError,
	markdownToBlocks,
} from "@/features/pages/lib/markdown";
import {
	type BlockJson,
	MAX_INITIAL_PAGE_CONTENT_BLOCKS,
	PAGE_TITLE_MAX_LENGTH,
} from "@/features/pages/schemas";

export const MAX_MARKDOWN_IMPORT_FILES = 20;
export const MAX_MARKDOWN_IMPORT_BYTES = 1_000_000;

export class MarkdownImportError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MarkdownImportError";
	}
}

export function isMarkdownFilename(filename: string): boolean {
	return /\.(?:md|markdown)$/i.test(filename.trim());
}

export function pageTitleFromMarkdownFilename(filename: string): string {
	const title = filename
		.trim()
		.replace(/\.(?:md|markdown)$/i, "")
		.trim();
	return (title || "Imported page").slice(0, PAGE_TITLE_MAX_LENGTH);
}

export function markdownFilenameForPage(title: string): string {
	const safe = Array.from(title.trim(), (character) =>
		character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character)
			? "-"
			: character,
	)
		.join("")
		.trim()
		.replace(/\s+/g, " ")
		.replace(/[. ]+$/g, "")
		.slice(0, 180)
		.trim();
	return `${safe || "Untitled"}.md`;
}

export function parseMarkdownPage(markdown: string): BlockJson[] {
	try {
		return markdownToBlocks(markdown, {
			maxBlocks: MAX_INITIAL_PAGE_CONTENT_BLOCKS,
		});
	} catch (error) {
		if (error instanceof MarkdownBlockLimitError) {
			throw new MarkdownImportError(
				`Markdown files may contain at most ${error.maxBlocks.toLocaleString()} blocks.`,
			);
		}
		throw error;
	}
}

export function downloadPageMarkdown(
	title: string,
	content: BlockJson[],
): void {
	const blob = new Blob([blocksToMarkdown(content)], {
		type: "text/markdown;charset=utf-8",
	});
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = markdownFilenameForPage(title);
	anchor.hidden = true;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

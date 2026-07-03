import type { BlockJson } from "@/features/pages/schemas";

export type PageBlockText = {
	blockId: string;
	text: string;
};

type InlineNode = {
	type?: string;
	text?: string;
	content?: unknown;
};

/** Concatenate the plain text of BlockNote inline content (text + links). */
function inlineText(content: unknown): string {
	if (!Array.isArray(content)) return "";

	let text = "";
	for (const node of content as InlineNode[]) {
		if (typeof node?.text === "string") {
			text += node.text;
		} else if (node?.content) {
			text += inlineText(node.content);
		}
	}
	return text;
}

/**
 * Flatten a BlockNote document (nested children included) into per-block
 * plain text. Blocks without any text (canvases, page links) are skipped.
 */
export function extractPageText(blocks: BlockJson[]): PageBlockText[] {
	const found: PageBlockText[] = [];

	function walk(nodes: BlockJson[]) {
		for (const block of nodes) {
			const text = inlineText(block.content).trim();
			if (text.length > 0) {
				found.push({ blockId: block.id, text });
			}
			if (block.children.length > 0) {
				walk(block.children);
			}
		}
	}

	walk(blocks);
	return found;
}

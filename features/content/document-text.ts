import { visitBlocks } from "./block-tree";
import { extractInlineText } from "./inline-content";
import type { BlockJson } from "./schemas";

export type DocumentBlockText = {
	blockId: string;
	text: string;
};

export function extractDocumentText(blocks: BlockJson[]): DocumentBlockText[] {
	const found: DocumentBlockText[] = [];
	visitBlocks(blocks, (block) => {
		const text = extractInlineText(block.content).trim();
		if (text.length > 0) found.push({ blockId: block.id, text });
	});
	return found;
}

export function extractDocumentSearchText(blocks: BlockJson[]): string {
	return extractDocumentText(blocks)
		.map((block) => block.text)
		.join("\n");
}

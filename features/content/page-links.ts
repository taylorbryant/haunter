import { visitBlocks } from "./block-tree";
import type { BlockJson } from "./schemas";

type InlineNode = {
	type?: string;
	props?: Record<string, unknown>;
	content?: unknown;
};

/** Collect unique page ids referenced by page-link blocks and inline mentions. */
export function extractPageLinks(blocks: BlockJson[]): string[] {
	const found = new Set<string>();

	const visitInline = (content: unknown): void => {
		if (!Array.isArray(content)) return;
		for (const node of content as InlineNode[]) {
			if (node?.type === "mention") {
				const pageId = node.props?.pageId;
				if (typeof pageId === "string" && pageId.length > 0) found.add(pageId);
			}
			if (node?.content) visitInline(node.content);
		}
	};

	visitBlocks(blocks, (block) => {
		if (block.type === "pageLink") {
			const pageId = block.props.pageId;
			if (typeof pageId === "string" && pageId.length > 0) found.add(pageId);
		}
		visitInline(block.content);
	});

	return [...found];
}

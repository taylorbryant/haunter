import type { BlockJson } from "@/features/pages/schemas";

type InlineNode = {
	type?: string;
	props?: Record<string, unknown>;
	content?: unknown;
};

/**
 * Collect the ids of pages referenced by a document: pageLink blocks and
 * inline mention nodes, nested children included. Self-references are the
 * caller's concern; this returns unique raw target ids.
 */
export function extractPageLinks(blocks: BlockJson[]): string[] {
	const found = new Set<string>();

	function walkInline(content: unknown) {
		if (!Array.isArray(content)) return;
		for (const node of content as InlineNode[]) {
			if (node?.type === "mention") {
				const pageId = node.props?.pageId;
				if (typeof pageId === "string" && pageId.length > 0) {
					found.add(pageId);
				}
			}
			if (node?.content) {
				walkInline(node.content);
			}
		}
	}

	function walk(nodes: BlockJson[]) {
		for (const block of nodes) {
			if (block.type === "pageLink") {
				const pageId = block.props.pageId;
				if (typeof pageId === "string" && pageId.length > 0) {
					found.add(pageId);
				}
			}
			walkInline(block.content);
			if (block.children.length > 0) {
				walk(block.children);
			}
		}
	}

	walk(blocks);
	return Array.from(found);
}

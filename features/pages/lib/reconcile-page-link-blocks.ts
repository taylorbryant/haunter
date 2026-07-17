import type { BlockJson } from "@/features/pages/schemas";

export type ReconcilePageLinkBlocksResult = {
	blocks: BlockJson[];
	changed: boolean;
};

function collectBlockIds(blocks: BlockJson[], ids: Set<string>) {
	for (const block of blocks) {
		ids.add(block.id);
		if (block.children.length > 0) collectBlockIds(block.children, ids);
	}
}

export function containsBlockId(blocks: BlockJson[], blockId: string): boolean {
	return blocks.some(
		(block) =>
			block.id === blockId ||
			(block.children.length > 0 && containsBlockId(block.children, blockId)),
	);
}

/**
 * Merge root page-link blocks written by a server-side page creation into a
 * collaborative document. Other server content is deliberately ignored so a
 * database refresh cannot replace newer text that only exists in Yjs yet.
 */
export function reconcilePageLinkBlocks(
	current: BlockJson[],
	authoritative: BlockJson[],
): ReconcilePageLinkBlocksResult {
	const currentIds = new Set<string>();
	collectBlockIds(current, currentIds);

	const missing = authoritative.filter(
		(block) => block.type === "pageLink" && !currentIds.has(block.id),
	);
	if (missing.length === 0) return { blocks: current, changed: false };

	return { blocks: [...current, ...missing], changed: true };
}

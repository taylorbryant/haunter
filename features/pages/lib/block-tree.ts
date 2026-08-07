import type { BlockJson } from "@/features/pages/schemas";

export function containsBlockId(blocks: BlockJson[], blockId: string): boolean {
	return blocks.some(
		(block) =>
			block.id === blockId ||
			(block.children.length > 0 && containsBlockId(block.children, blockId)),
	);
}

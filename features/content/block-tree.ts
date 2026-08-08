import type { BlockJson } from "./schemas";

export function visitBlocks(
	blocks: BlockJson[],
	visitor: (block: BlockJson) => void,
): void {
	for (const block of blocks) {
		visitor(block);
		if (block.children.length > 0) visitBlocks(block.children, visitor);
	}
}

export function mapBlocks(
	blocks: BlockJson[],
	mapper: (block: BlockJson) => BlockJson,
): BlockJson[] {
	return blocks.map((block) => {
		const children =
			block.children.length > 0
				? mapBlocks(block.children, mapper)
				: block.children;
		const childrenChanged = children.some(
			(child, index) => child !== block.children[index],
		);
		const withMappedChildren = childrenChanged ? { ...block, children } : block;
		return mapper(withMappedChildren);
	});
}

export function findBlockById(
	blocks: BlockJson[],
	blockId: string,
): BlockJson | null {
	let match: BlockJson | null = null;
	visitBlocks(blocks, (block) => {
		if (match === null && block.id === blockId) match = block;
	});
	return match;
}

export function containsBlockId(blocks: BlockJson[], blockId: string): boolean {
	return findBlockById(blocks, blockId) !== null;
}

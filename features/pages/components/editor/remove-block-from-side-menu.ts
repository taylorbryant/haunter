type BlockIdentity = { id: string };

type RemoveBlockFromSideMenuOptions<TBlock extends BlockIdentity> = {
	hoveredBlock: TBlock;
	selectedBlocks?: readonly TBlock[];
	unfreezeMenu: () => void;
	removeBlocks: (blocks: TBlock[]) => void;
};

/**
 * Releases BlockNote's frozen side menu before deleting its anchor block.
 * Otherwise the dropdown can unmount before its close event runs, leaving the
 * side menu attached to a block that no longer exists.
 */
export function removeBlockFromSideMenu<TBlock extends BlockIdentity>({
	hoveredBlock,
	selectedBlocks,
	unfreezeMenu,
	removeBlocks,
}: RemoveBlockFromSideMenuOptions<TBlock>) {
	const blocksToRemove = selectedBlocks?.some(
		(block) => block.id === hoveredBlock.id,
	)
		? [...selectedBlocks]
		: [hoveredBlock];

	unfreezeMenu();
	removeBlocks(blocksToRemove);
}

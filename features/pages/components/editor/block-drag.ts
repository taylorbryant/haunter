type BlockDragController = {
	blockDragEnd: () => void;
	unfreezeMenu: () => void;
};

/**
 * BlockNote's drag handle is also a menu trigger. The menu opens on mouse down,
 * so a completed native drag must explicitly close the menu's frozen state.
 */
export function finishBlockDrag(controller: BlockDragController) {
	controller.blockDragEnd();
	controller.unfreezeMenu();
}

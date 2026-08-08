import { mapBlocks } from "@/features/content/block-tree";
import type { BlockJson } from "@/features/content/schemas";
import type { TaskBlockPatch } from "@/features/tasks/ports";

export type { TaskBlockPatch } from "@/features/tasks/ports";

export type PatchResult = {
	blocks: BlockJson[];
	found: boolean;
};

export type TaskBlockPropsPatch = {
	checked?: boolean;
	due?: string;
	dueTime?: string;
	reminder?: string;
	assignee?: string;
};

export function toTaskBlockProps(patch: TaskBlockPatch): TaskBlockPropsPatch {
	return {
		...(patch.checked !== undefined ? { checked: patch.checked } : {}),
		...(patch.due !== undefined ? { due: patch.due ?? "" } : {}),
		...(patch.dueTime !== undefined ? { dueTime: patch.dueTime ?? "" } : {}),
		...(patch.reminderOffsetMinutes !== undefined
			? {
					reminder:
						patch.reminderOffsetMinutes === null
							? ""
							: String(patch.reminderOffsetMinutes),
				}
			: {}),
		...(patch.assignee !== undefined ? { assignee: patch.assignee ?? "" } : {}),
	};
}

/**
 * Return a new document tree with the given task block's props updated.
 * The original tree is not mutated. `found` reports whether the block exists.
 */
export function patchTaskBlock(
	blocks: BlockJson[],
	blockId: string,
	patch: TaskBlockPatch,
): PatchResult {
	let found = false;
	const props = toTaskBlockProps(patch);

	const patched = mapBlocks(blocks, (block) => {
		if (block.type !== "task" || block.id !== blockId) return block;
		found = true;
		return { ...block, props: { ...block.props, ...props } };
	});
	return { blocks: patched, found };
}

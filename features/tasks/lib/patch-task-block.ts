import type { BlockJson } from "@/features/pages/schemas";

export type TaskBlockPatch = {
	checked?: boolean;
	due?: string | null;
	dueTime?: string | null;
	reminderOffsetMinutes?: number | null;
	assignee?: string | null;
};

export type PatchResult = {
	blocks: BlockJson[];
	found: boolean;
};

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

	function walk(nodes: BlockJson[]): BlockJson[] {
		return nodes.map((block) => {
			if (block.type === "task" && block.id === blockId) {
				found = true;
				return {
					...block,
					props: {
						...block.props,
						...(patch.checked !== undefined ? { checked: patch.checked } : {}),
						...(patch.due !== undefined ? { due: patch.due ?? "" } : {}),
						...(patch.dueTime !== undefined
							? { dueTime: patch.dueTime ?? "" }
							: {}),
						...(patch.reminderOffsetMinutes !== undefined
							? {
									reminder:
										patch.reminderOffsetMinutes === null
											? ""
											: String(patch.reminderOffsetMinutes),
								}
							: {}),
						...(patch.assignee !== undefined
							? { assignee: patch.assignee ?? "" }
							: {}),
					},
				};
			}
			if (block.children.length > 0) {
				return { ...block, children: walk(block.children) };
			}
			return block;
		});
	}

	const patched = walk(blocks);
	return { blocks: patched, found };
}

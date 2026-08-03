import type { BlockJson } from "@/features/pages/schemas";
import { isAutoTaskAssignee } from "./task-block-props";

export type ExtractedTaskBlock = {
	blockId: string;
	title: string;
	checked: boolean;
	due: string | null;
	dueTime: string | null;
	reminderOffsetMinutes: number | null;
	/** User id from the block's assignee prop; null when unassigned. */
	assignee: string | null;
	/** New editor task blocks can request assignment to the current saver. */
	useDefaultAssignee: boolean;
	/** Exact serialized prop used to bind mutation attribution to this state. */
	rawAssignee: string;
};

type InlineNode = {
	type?: string;
	text?: string;
	content?: unknown;
};

/** Concatenate the plain text of BlockNote inline content (text + links). */
function inlineText(content: unknown): string {
	if (!Array.isArray(content)) return "";

	let text = "";
	for (const node of content as InlineNode[]) {
		if (typeof node?.text === "string") {
			text += node.text;
		} else if (node?.content) {
			text += inlineText(node.content);
		}
	}
	return text;
}

/**
 * Walk a BlockNote document (including nested children) and pull out every
 * task block. Duplicate block ids are ignored after the first occurrence.
 */
export function extractTaskBlocks(blocks: BlockJson[]): ExtractedTaskBlock[] {
	const found: ExtractedTaskBlock[] = [];
	const seen = new Set<string>();

	function walk(nodes: BlockJson[]) {
		for (const block of nodes) {
			if (block.type === "task" && !seen.has(block.id)) {
				seen.add(block.id);
				const due = block.props.due;
				const dueTime = block.props.dueTime;
				const reminder = block.props.reminder;
				const assignee = block.props.assignee;
				const useDefaultAssignee = isAutoTaskAssignee(assignee);
				found.push({
					blockId: block.id,
					title: inlineText(block.content),
					checked: block.props.checked === true,
					due: typeof due === "string" && due.length > 0 ? due : null,
					dueTime:
						typeof dueTime === "string" && dueTime.length > 0 ? dueTime : null,
					reminderOffsetMinutes:
						typeof reminder === "string" && reminder.length > 0
							? Number(reminder)
							: null,
					assignee:
						typeof assignee === "string" &&
						assignee.length > 0 &&
						!useDefaultAssignee
							? assignee
							: null,
					useDefaultAssignee,
					rawAssignee: typeof assignee === "string" ? assignee : "",
				});
			}
			if (block.children.length > 0) {
				walk(block.children);
			}
		}
	}

	walk(blocks);
	return found;
}

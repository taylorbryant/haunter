import type { BlockJson } from "@/features/pages/schemas";
import { isAutoTaskAssignee } from "./task-block-props";

export type ExtractedTaskBlock = {
	blockId: string;
	title: string;
	checked: boolean;
	due: string | null;
	/** User id from the block's assignee prop; null when unassigned. */
	assignee: string | null;
	/** New editor task blocks can request assignment to the current saver. */
	useDefaultAssignee: boolean;
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
				const assignee = block.props.assignee;
				const useDefaultAssignee = isAutoTaskAssignee(assignee);
				found.push({
					blockId: block.id,
					title: inlineText(block.content),
					checked: block.props.checked === true,
					due: typeof due === "string" && due.length > 0 ? due : null,
					assignee:
						typeof assignee === "string" &&
						assignee.length > 0 &&
						!useDefaultAssignee
							? assignee
							: null,
					useDefaultAssignee,
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

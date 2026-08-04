import type { BlockJson } from "@/features/pages/schemas";

/**
 * BlockNote renders a 30px trailing click target in editable documents unless
 * the last root block is already an empty paragraph. The projection is
 * read-only, so reserve the same space during the collaboration handoff.
 */
export function needsEditableTrailingSpace(content: BlockJson[]): boolean {
	const lastBlock = content.at(-1);
	if (!lastBlock) return false;
	if (lastBlock.type !== "paragraph") return true;

	const inlineContent = lastBlock.content;
	return !(
		inlineContent == null ||
		inlineContent === "" ||
		(Array.isArray(inlineContent) && inlineContent.length === 0)
	);
}

import type { BlockJson } from "@/features/pages/schemas";

/**
 * Reminder delivery is assignee-specific metadata. Public shares may render a
 * task's due date, but must not expose its reminder configuration.
 */
export function stripPrivateTaskProps(blocks: BlockJson[]): BlockJson[] {
	return blocks.map((block) => {
		const children =
			block.children.length > 0
				? stripPrivateTaskProps(block.children)
				: block.children;
		const hasReminder = block.type === "task" && "reminder" in block.props;
		if (!hasReminder && children === block.children) return block;

		return {
			...block,
			...(hasReminder
				? {
						props: Object.fromEntries(
							Object.entries(block.props).filter(([key]) => key !== "reminder"),
						),
					}
				: {}),
			children,
		};
	});
}

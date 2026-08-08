import type { BlockJson } from "@/features/content/schemas";

/** Public shares may render task state and scheduling, but not user-specific
 * ownership or notification metadata.
 */
export function stripPrivateTaskProps(blocks: BlockJson[]): BlockJson[] {
	return blocks.map((block) => {
		const children =
			block.children.length > 0
				? stripPrivateTaskProps(block.children)
				: block.children;
		const hasPrivateTaskProps =
			block.type === "task" &&
			("reminder" in block.props || "assignee" in block.props);
		if (!hasPrivateTaskProps && children === block.children) return block;

		return {
			...block,
			...(hasPrivateTaskProps
				? {
						props: Object.fromEntries(
							Object.entries(block.props).filter(
								([key]) => key !== "reminder" && key !== "assignee",
							),
						),
					}
				: {}),
			children,
		};
	});
}

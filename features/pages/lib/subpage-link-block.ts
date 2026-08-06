import type { BlockJson, PageMeta } from "@/features/pages/schemas";

/**
 * The child id is also the block id so retries can address the same append
 * without creating duplicate blocks.
 */
export function createSubpageLinkBlock(
	child: Pick<PageMeta, "id" | "workspaceId">,
): BlockJson {
	return {
		id: child.id,
		type: "pageLink",
		props: {
			pageId: child.id,
			workspaceId: child.workspaceId,
		},
		children: [],
	};
}

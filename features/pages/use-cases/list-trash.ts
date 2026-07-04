import "@beignet/core/server-only";
import { requireActiveWorkspace } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { ListTrashInputSchema, ListTrashOutputSchema } from "../schemas";

/**
 * List trashed subtree roots: trashed pages whose parent is live or missing.
 * Subtree members restore or purge together with their root.
 */
export const listTrashUseCase = useCase
	.query("pages.listTrash")
	.input(ListTrashInputSchema)
	.output(ListTrashOutputSchema)
	.run(async ({ ctx, input }) => {
		requireActiveWorkspace(ctx, input.workspaceId);

		const trashed = await ctx.ports.pages.listTrashedMetaByWorkspace(
			input.workspaceId,
		);
		const trashedIds = new Set(trashed.map((page) => page.id));
		const items = trashed
			.filter(
				(page) =>
					page.parentPageId === null || !trashedIds.has(page.parentPageId),
			)
			.sort((left, right) =>
				(right.deletedAt ?? "").localeCompare(left.deletedAt ?? ""),
			);

		return { items };
	});

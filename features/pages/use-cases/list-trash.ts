import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireUser } from "@/lib/auth";
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
		requireUser(ctx);

		const workspace = await ctx.ports.workspaces.findById(input.workspaceId);
		if (!workspace) {
			throw appError("WorkspaceNotFound", {
				details: { id: input.workspaceId },
			});
		}

		await ctx.gate.authorize("workspaces.read", workspace);

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

import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { DeletePageOutputSchema, PageIdInputSchema } from "../schemas";
import { collectSubtreeIds } from "./delete-page";

/** Permanently delete a page and its subtree, with its canvases and tasks. */
export const purgePageUseCase = useCase
	.command("pages.purge")
	.input(PageIdInputSchema)
	.output(DeletePageOutputSchema)
	.run(async ({ ctx, input }) => {
		requireUser(ctx);

		await ctx.ports.uow.transaction(async (tx) => {
			const page = await tx.pages.findMetaById(input.id);
			if (!page) {
				throw appError("PageNotFound", { details: { id: input.id } });
			}

			await ctx.gate.authorize("pages.delete", page);

			const subtree = await collectSubtreeIds(
				tx.pages,
				page.workspaceId,
				page.id,
			);
			await tx.canvases.deleteByPageIds(subtree);
			await tx.tasks.deleteByPageIds(subtree);
			// Delete children before parents so the self-FK never dangles.
			await tx.pages.deleteByIds(subtree.reverse());
		});
	});

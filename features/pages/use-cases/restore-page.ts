import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { PageIdInputSchema, PageMetaSchema } from "../schemas";
import { collectSubtreeIds } from "./delete-page";

/** Restore a trashed page (and its subtree) back into the workspace. */
export const restorePageUseCase = useCase
	.command("pages.restore")
	.input(PageIdInputSchema)
	.output(PageMetaSchema)
	.run(async ({ ctx, input }) => {
		const scope = requireActiveWorkspaceScope(ctx);

		return ctx.ports.uow.transaction(async (tx) => {
			const page = await tx.pages.findMetaById(scope, input.id);
			if (!page) {
				throw appError("PageNotFound", { details: { id: input.id } });
			}

			await ctx.gate.authorize("pages.update", page);

			if (page.deletedAt === null) {
				return page;
			}

			const subtree = await collectSubtreeIds(tx.pages, scope, page.id);
			await tx.pages.setDeletedByIds(scope, subtree, null);

			// If the original parent is gone or still trashed, surface the page
			// at the workspace root instead of leaving it orphaned.
			const parent = page.parentPageId
				? await tx.pages.findMetaById(scope, page.parentPageId)
				: null;
			if (page.parentPageId && (!parent || parent.deletedAt !== null)) {
				const position = (await tx.pages.maxPositionForParent(scope, null)) + 1;

				return tx.pages.update(scope, page.id, {
					parentPageId: null,
					position,
				});
			}

			const restored = await tx.pages.findMetaById(scope, page.id);
			if (!restored) {
				throw appError("PageNotFound", { details: { id: input.id } });
			}
			return restored;
		});
	});

import "@beignet/core/server-only";
import { scheduleWorkspacePageEvent } from "@/features/collab/server/workspace-events";
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

		const {
			page: restored,
			changed,
			subtree,
		} = await ctx.ports.uow.transaction(async (tx) => {
			const page = await tx.pages.findMetaById(scope, input.id);
			if (!page) {
				throw appError("PageNotFound", { details: { id: input.id } });
			}

			await ctx.gate.authorize("pages.update", page);

			if (page.deletedAt === null) {
				return { page, changed: false, subtree: [page.id] };
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

				return {
					page: await tx.pages.update(scope, page.id, {
						parentPageId: null,
						position,
					}),
					changed: true,
					subtree,
				};
			}

			const restored = await tx.pages.findMetaById(scope, page.id);
			if (!restored) {
				throw appError("PageNotFound", { details: { id: input.id } });
			}
			return { page: restored, changed: true, subtree };
		});
		if (changed) {
			scheduleWorkspacePageEvent(ctx, {
				type: "page.restored",
				workspaceId: restored.workspaceId,
				pageId: restored.id,
				affectedPageIds: subtree,
			});
		}
		return restored;
	});

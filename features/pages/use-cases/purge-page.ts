import "@beignet/core/server-only";
import { tenantScopeId } from "@beignet/core/ports";
import { scheduleWorkspacePageEvent } from "@/features/collab/server/workspace-events";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { DeletePageOutputSchema, PageIdInputSchema } from "../schemas";
import { collectSubtreeIds } from "./delete-page";

/** Permanently delete a page and its subtree, with its canvases and tasks. */
export const purgePageUseCase = useCase
	.command("pages.purge")
	.input(PageIdInputSchema)
	.output(DeletePageOutputSchema)
	.run(async ({ ctx, input }) => {
		const scope = requireActiveWorkspaceScope(ctx);

		const { documentIds, subtree } = await ctx.ports.uow.transaction(
			async (tx) => {
				const page = await tx.pages.findMetaById(scope, input.id);
				if (!page) {
					throw appError("PageNotFound", { details: { id: input.id } });
				}

				await ctx.gate.authorize("pages.delete", page);

				const subtree = await collectSubtreeIds(tx.pages, scope, page.id);
				const canvasIds = await tx.canvases.listIdsByPageIds(scope, subtree);
				const documentIds = await tx.documents.deleteByEntities(scope, [
					...subtree.map((entityId) => ({ kind: "page" as const, entityId })),
					...canvasIds.map((entityId) => ({
						kind: "canvas" as const,
						entityId,
					})),
				]);
				await tx.canvases.deleteByPageIds(scope, subtree);
				await tx.tasks.deleteByPageIds(scope, subtree);
				// Delete children before parents so the self-FK never dangles.
				await tx.pages.deleteByIds(scope, [...subtree].reverse());
				return { documentIds, subtree };
			},
		);
		scheduleWorkspacePageEvent(ctx, {
			type: "page.purged",
			workspaceId: tenantScopeId(scope),
			pageId: input.id,
			affectedPageIds: subtree,
		});

		for (const documentId of documentIds) {
			try {
				await ctx.ports.documentStore.deleteDocument(documentId);
			} catch (error) {
				// The database deletion is authoritative for access. A provider room
				// left behind after a transport failure is inaccessible and can be
				// removed by provider retention or a later cleanup task.
				ctx.ports.logger.warn("Failed to delete a purged document room", {
					documentId,
					error,
				});
			}
		}
	});

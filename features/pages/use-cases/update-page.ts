import "@beignet/core/server-only";
import type { TenantScope } from "@beignet/core/ports";
import { scheduleWorkspacePageEvent } from "@/features/collab/server/workspace-events";
import type { PageRepository } from "@/features/pages/ports";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { PageMetaSchema, UpdatePageInputSchema } from "../schemas";

async function assertNotDescendant(
	pages: Pick<PageRepository, "findMetaById">,
	scope: TenantScope,
	pageId: string,
	newParentId: string,
) {
	let currentId: string | null = newParentId;
	const seen = new Set<string>();

	while (currentId) {
		if (currentId === pageId) {
			throw appError("InvalidPageMove", {
				details: { pageId, parentPageId: newParentId },
			});
		}
		if (seen.has(currentId)) break;
		seen.add(currentId);

		const current = await pages.findMetaById(scope, currentId);
		currentId = current?.parentPageId ?? null;
	}
}

export const updatePageUseCase = useCase
	.command("pages.update")
	.input(UpdatePageInputSchema)
	.output(PageMetaSchema)
	.run(async ({ ctx, input }) => {
		const scope = requireActiveWorkspaceScope(ctx);

		const updated = await ctx.ports.uow.transaction(async (tx) => {
			const page = await tx.pages.findMetaById(scope, input.id);
			if (!page || page.deletedAt !== null) {
				throw appError("PageNotFound", { details: { id: input.id } });
			}

			await ctx.gate.authorize("pages.update", page);

			if (
				input.parentPageId !== undefined &&
				input.parentPageId !== null &&
				input.parentPageId !== page.parentPageId
			) {
				const parent = await tx.pages.findMetaById(scope, input.parentPageId);
				if (!parent || parent.deletedAt !== null) {
					throw appError("PageNotFound", {
						details: { id: input.parentPageId },
					});
				}
				await assertNotDescendant(tx.pages, scope, page.id, input.parentPageId);
			}

			return tx.pages.update(scope, input.id, {
				...(input.title !== undefined ? { title: input.title } : {}),
				...(input.icon !== undefined ? { icon: input.icon } : {}),
				...(input.parentPageId !== undefined
					? { parentPageId: input.parentPageId }
					: {}),
				...(input.position !== undefined ? { position: input.position } : {}),
			});
		});
		const eventType =
			input.parentPageId !== undefined || input.position !== undefined
				? "page.moved"
				: input.title !== undefined
					? "page.renamed"
					: input.icon !== undefined
						? "page.iconChanged"
						: null;
		if (eventType) {
			scheduleWorkspacePageEvent(ctx, {
				type: eventType,
				workspaceId: updated.workspaceId,
				pageId: updated.id,
			});
		}
		return updated;
	});

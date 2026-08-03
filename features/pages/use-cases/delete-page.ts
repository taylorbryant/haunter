import "@beignet/core/server-only";
import { type TenantScope, tenantScopeId } from "@beignet/core/ports";
import { scheduleWorkspacePageEvent } from "@/features/collab/server/workspace-events";
import type { PageRepository } from "@/features/pages/ports";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { DeletePageOutputSchema, PageIdInputSchema } from "../schemas";

/** Collect the page and all descendants with a single workspace hierarchy read. */
export async function collectSubtreeIds(
	pages: Pick<PageRepository, "listHierarchyByWorkspace">,
	scope: TenantScope,
	rootId: string,
): Promise<string[]> {
	const childrenByParent = new Map<string, string[]>();
	for (const row of await pages.listHierarchyByWorkspace(scope)) {
		if (!row.parentPageId) continue;
		const children = childrenByParent.get(row.parentPageId) ?? [];
		children.push(row.id);
		childrenByParent.set(row.parentPageId, children);
	}

	const ids: string[] = [rootId];
	for (let cursor = 0; cursor < ids.length; cursor++) {
		const id = ids[cursor];
		if (id === undefined) break;
		ids.push(...(childrenByParent.get(id) ?? []));
	}
	return ids;
}

/** Soft delete: move the page and its whole subtree to the trash. */
export const deletePageUseCase = useCase
	.command("pages.delete")
	.input(PageIdInputSchema)
	.output(DeletePageOutputSchema)
	.run(async ({ ctx, input }) => {
		const scope = requireActiveWorkspaceScope(ctx);

		const subtree = await ctx.ports.uow.transaction(async (tx) => {
			const page = await tx.pages.findMetaById(scope, input.id);
			if (!page || page.deletedAt !== null) {
				throw appError("PageNotFound", { details: { id: input.id } });
			}

			await ctx.gate.authorize("pages.delete", page);

			const subtree = await collectSubtreeIds(tx.pages, scope, page.id);
			await tx.pages.setDeletedByIds(scope, subtree, new Date().toISOString());
			return subtree;
		});
		scheduleWorkspacePageEvent(ctx, {
			type: "page.trashed",
			workspaceId: tenantScopeId(scope),
			pageId: input.id,
			affectedPageIds: subtree,
		});
	});

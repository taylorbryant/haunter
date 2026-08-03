import "@beignet/core/server-only";
import type { TenantScope } from "@beignet/core/ports";
import type { AppContext } from "@/app-context";
import { scheduleWorkspacePageEvent } from "@/features/collab/server/workspace-events";
import { replacePageTitle } from "@/features/documents/codec";
import { mutateCollaborativeDocument } from "@/features/documents/service";
import type { PageRepository } from "@/features/pages/ports";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { PageMetaSchema, UpdatePageInputSchema } from "../schemas";

function schedulePageUpdateEvents(
	ctx: AppContext,
	input: {
		id: string;
		title?: string;
		icon?: string | null;
		parentPageId?: string | null;
		position?: number;
	},
	workspaceId: string,
) {
	if (input.title !== undefined) {
		scheduleWorkspacePageEvent(ctx, {
			type: "page.renamed",
			workspaceId,
			pageId: input.id,
		});
	}
	if (input.icon !== undefined) {
		scheduleWorkspacePageEvent(ctx, {
			type: "page.iconChanged",
			workspaceId,
			pageId: input.id,
		});
	}
	if (input.parentPageId !== undefined || input.position !== undefined) {
		scheduleWorkspacePageEvent(ctx, {
			type: "page.moved",
			workspaceId,
			pageId: input.id,
		});
	}
}

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

		if (input.title !== undefined) {
			const page = await ctx.ports.pages.findMetaById(scope, input.id);
			if (!page || page.deletedAt !== null) {
				throw appError("PageNotFound", { details: { id: input.id } });
			}
			await ctx.gate.authorize("pages.update", page);
			if (
				input.parentPageId !== undefined &&
				input.parentPageId !== null &&
				input.parentPageId !== page.parentPageId
			) {
				const parent = await ctx.ports.pages.findMetaById(
					scope,
					input.parentPageId,
				);
				if (!parent || parent.deletedAt !== null) {
					throw appError("PageNotFound", {
						details: { id: input.parentPageId },
					});
				}
				await assertNotDescendant(
					ctx.ports.pages,
					scope,
					page.id,
					input.parentPageId,
				);
			}

			await mutateCollaborativeDocument({
				scope,
				kind: "page",
				entityId: page.id,
				ports: ctx.ports,
				apply(doc) {
					replacePageTitle(doc, input.title ?? "");
				},
			});

			if (
				input.icon !== undefined ||
				input.parentPageId !== undefined ||
				input.position !== undefined
			) {
				await ctx.ports.pages.update(scope, input.id, {
					...(input.icon !== undefined ? { icon: input.icon } : {}),
					...(input.parentPageId !== undefined
						? { parentPageId: input.parentPageId }
						: {}),
					...(input.position !== undefined ? { position: input.position } : {}),
				});
			}
			const updated = await ctx.ports.pages.findMetaById(scope, input.id);
			if (!updated) {
				throw appError("PageNotFound", { details: { id: input.id } });
			}
			schedulePageUpdateEvents(ctx, input, updated.workspaceId);
			return updated;
		}

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
		schedulePageUpdateEvents(ctx, input, updated.workspaceId);
		return updated;
	});

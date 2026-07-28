import "@beignet/core/server-only";
import { assertValidPageParent } from "@/features/pages/lib/page-move";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { PageMetaSchema, UpdatePageInputSchema } from "../schemas";

export const updatePageUseCase = useCase
	.command("pages.update")
	.input(UpdatePageInputSchema)
	.output(PageMetaSchema)
	.run(async ({ ctx, input }) => {
		const scope = requireActiveWorkspaceScope(ctx);

		return ctx.ports.uow.transaction(async (tx) => {
			const page = await tx.pages.findMetaById(scope, input.id);
			if (!page || page.deletedAt !== null) {
				throw appError("PageNotFound", { details: { id: input.id } });
			}

			await ctx.gate.authorize("pages.update", page);

			if (
				input.parentPageId !== undefined &&
				input.parentPageId !== page.parentPageId
			) {
				await assertValidPageParent(
					tx.pages,
					scope,
					page.id,
					input.parentPageId,
				);
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
	});

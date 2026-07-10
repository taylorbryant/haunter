import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { CreatePageInputSchema, PageMetaSchema } from "../schemas";

export const createPageUseCase = useCase
	.command("pages.create")
	.input(CreatePageInputSchema)
	.output(PageMetaSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		await ctx.gate.authorize("pages.create");
		const scope = requireActiveWorkspaceScope(ctx, input.workspaceId);

		return ctx.ports.uow.transaction(async (tx) => {
			const parentPageId = input.parentPageId ?? null;
			if (parentPageId) {
				const parent = await tx.pages.findMetaById(scope, parentPageId);
				if (!parent || parent.deletedAt !== null) {
					throw appError("PageNotFound", { details: { id: parentPageId } });
				}
			}

			const position =
				(await tx.pages.maxPositionForParent(scope, parentPageId)) + 1;

			return tx.pages.create(scope, {
				userId: user.id,
				parentPageId,
				title: input.title,
				position,
			});
		});
	});

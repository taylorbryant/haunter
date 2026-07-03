import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { CreatePageInputSchema, PageMetaSchema } from "../schemas";

export const createPageUseCase = useCase
	.command("pages.create")
	.input(CreatePageInputSchema)
	.output(PageMetaSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		await ctx.gate.authorize("pages.create");

		return ctx.ports.uow.transaction(async (tx) => {
			const workspace = await tx.workspaces.findById(input.workspaceId);
			if (!workspace) {
				throw appError("WorkspaceNotFound", {
					details: { id: input.workspaceId },
				});
			}

			await ctx.gate.authorize("workspaces.update", workspace);

			const parentPageId = input.parentPageId ?? null;
			if (parentPageId) {
				const parent = await tx.pages.findMetaById(parentPageId);
				if (
					!parent ||
					parent.workspaceId !== input.workspaceId ||
					parent.deletedAt !== null
				) {
					throw appError("PageNotFound", { details: { id: parentPageId } });
				}
			}

			const siblings = await tx.pages.listMetaByWorkspace(input.workspaceId);
			const position =
				siblings
					.filter((page) => page.parentPageId === parentPageId)
					.reduce((max, page) => Math.max(max, page.position), 0) + 1;

			return tx.pages.create({
				userId: user.id,
				workspaceId: input.workspaceId,
				parentPageId,
				title: input.title,
				position,
			});
		});
	});

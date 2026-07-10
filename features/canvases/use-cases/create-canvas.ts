import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { CanvasSchema, CreateCanvasInputSchema } from "../schemas";

export const createCanvasUseCase = useCase
	.command("canvases.create")
	.input(CreateCanvasInputSchema)
	.output(CanvasSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		await ctx.gate.authorize("canvases.create");
		const scope = requireActiveWorkspaceScope(ctx, input.workspaceId);

		return ctx.ports.uow.transaction(async (tx) => {
			const page = await tx.pages.findMetaById(scope, input.pageId);
			if (!page || page.deletedAt !== null) {
				throw appError("PageNotFound", { details: { id: input.pageId } });
			}

			// The canvas belongs to the page's owner; creating one is a page edit.
			await ctx.gate.authorize("pages.update", page);

			return tx.canvases.create(scope, {
				userId: user.id,
				pageId: input.pageId,
			});
		});
	});

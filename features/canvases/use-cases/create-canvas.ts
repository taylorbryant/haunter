import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { CanvasSchema, CreateCanvasInputSchema } from "../schemas";

export const createCanvasUseCase = useCase
	.command("canvases.create")
	.input(CreateCanvasInputSchema)
	.output(CanvasSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		await ctx.gate.authorize("canvases.create");

		return ctx.ports.uow.transaction(async (tx) => {
			const page = await tx.pages.findMetaById(input.pageId);
			if (
				!page ||
				page.deletedAt !== null ||
				page.workspaceId !== input.workspaceId
			) {
				throw appError("PageNotFound", { details: { id: input.pageId } });
			}

			// The canvas belongs to the page's owner; creating one is a page edit.
			await ctx.gate.authorize("pages.update", page);

			return tx.canvases.create({
				userId: user.id,
				workspaceId: input.workspaceId,
				pageId: input.pageId,
			});
		});
	});

import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { CanvasIdInputSchema, CanvasSchema } from "../schemas";

export const getCanvasUseCase = useCase
	.query("canvases.get")
	.input(CanvasIdInputSchema)
	.output(CanvasSchema)
	.run(async ({ ctx, input }) => {
		const scope = requireActiveWorkspaceScope(ctx);

		const canvas = await ctx.ports.canvases.findById(scope, input.id);
		if (!canvas) {
			throw appError("CanvasNotFound", { details: { id: input.id } });
		}

		await ctx.gate.authorize("canvases.read", canvas);
		if (canvas.pageId !== null) {
			const page = await ctx.ports.pages.findMetaById(scope, canvas.pageId);
			if (!page || page.deletedAt !== null) {
				throw appError("CanvasNotFound", { details: { id: input.id } });
			}
		}

		return canvas;
	});

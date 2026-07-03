import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { CanvasIdInputSchema, CanvasSchema } from "../schemas";

export const getCanvasUseCase = useCase
	.query("canvases.get")
	.input(CanvasIdInputSchema)
	.output(CanvasSchema)
	.run(async ({ ctx, input }) => {
		requireUser(ctx);

		const canvas = await ctx.ports.canvases.findById(input.id);
		if (!canvas) {
			throw appError("CanvasNotFound", { details: { id: input.id } });
		}

		await ctx.gate.authorize("canvases.read", canvas);

		return canvas;
	});

import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { CanvasIdInputSchema, RecordCanvasViewOutputSchema } from "../schemas";

export const recordCanvasViewUseCase = useCase
	.command("canvases.recordView")
	.input(CanvasIdInputSchema)
	.output(RecordCanvasViewOutputSchema)
	.run(async ({ ctx, input }) => {
		const scope = requireActiveWorkspaceScope(ctx);
		const user = requireUser(ctx);
		const canvas = await ctx.ports.canvases.findById(scope, input.id);
		if (!canvas) {
			throw appError("CanvasNotFound", { details: { id: input.id } });
		}

		await ctx.gate.authorize("canvases.read", canvas);
		if (canvas.pageId !== null) {
			throw appError("CanvasNotEditable", { details: { id: input.id } });
		}

		const lastViewedAt = await ctx.ports.canvasNavigation.recordView(
			scope,
			user.id,
			canvas.id,
		);
		return { canvasId: canvas.id, lastViewedAt };
	});

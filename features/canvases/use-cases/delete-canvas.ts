import "@beignet/core/server-only";
import { scheduleWorkspaceCanvasEvent } from "@/features/collab/server/workspace-events";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { CanvasIdInputSchema, DeleteCanvasOutputSchema } from "../schemas";

export const deleteCanvasUseCase = useCase
	.command("canvases.delete")
	.input(CanvasIdInputSchema)
	.output(DeleteCanvasOutputSchema)
	.run(async ({ ctx, input }) => {
		const scope = requireActiveWorkspaceScope(ctx);
		const canvas = await ctx.ports.canvases.findById(scope, input.id);
		if (!canvas) {
			throw appError("CanvasNotFound", { details: { id: input.id } });
		}

		await ctx.gate.authorize("canvases.delete", canvas);
		if (canvas.pageId !== null) {
			throw appError("CanvasNotEditable", { details: { id: input.id } });
		}

		await ctx.ports.canvases.delete(scope, input.id);
		scheduleWorkspaceCanvasEvent(ctx, {
			workspaceId: canvas.workspaceId,
			canvasId: canvas.id,
			pageId: null,
		});
	});

import "@beignet/core/server-only";
import { scheduleWorkspaceCanvasEvent } from "@/features/collab/server/workspace-events";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { CanvasSchema, UpdateCanvasInputSchema } from "../schemas";

export const updateCanvasUseCase = useCase
	.command("canvases.update")
	.input(UpdateCanvasInputSchema)
	.output(CanvasSchema)
	.run(async ({ ctx, input }) => {
		const scope = requireActiveWorkspaceScope(ctx);
		const canvas = await ctx.ports.canvases.findById(scope, input.id);
		if (!canvas) {
			throw appError("CanvasNotFound", { details: { id: input.id } });
		}

		await ctx.gate.authorize("canvases.update", canvas);
		if (canvas.pageId !== null) {
			throw appError("CanvasNotEditable", { details: { id: input.id } });
		}

		const updated = await ctx.ports.canvases.updateTitle(
			scope,
			input.id,
			input.title,
		);
		scheduleWorkspaceCanvasEvent(ctx, {
			workspaceId: updated.workspaceId,
			canvasId: updated.id,
			pageId: null,
		});
		return updated;
	});

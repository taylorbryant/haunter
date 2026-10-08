import "@beignet/core/server-only";
import { scheduleWorkspaceCanvasEvent } from "@/features/collab/server/workspace-events";
import { tenantScopeId } from "@beignet/core/ports";
import { useCase } from "@/lib/use-case";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import {
	CanvasCommandSchema,
	CanvasCommandOutputSchema,
	isCanvasWrite,
} from "../editing";
import { authorizeCanvas } from "../lib/authorize-canvas";

export const canvasCommandUseCase = useCase
	.command("canvases.agentCommand")
	.input(CanvasCommandSchema)
	.output(CanvasCommandOutputSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		const canvas = await authorizeCanvas(
			ctx,
			input.canvasId,
			isCanvasWrite(input),
		);
		const result = await ctx.ports.canvasEditing.execute({
			userId: user.id,
			workspaceId: tenantScopeId(requireActiveWorkspaceScope(ctx)),
			command: input,
		});
		if (isCanvasWrite(input))
			scheduleWorkspaceCanvasEvent(ctx, {
				workspaceId: canvas.workspaceId,
				canvasId: canvas.id,
				pageId: canvas.pageId,
			});
		return result;
	});

import "@beignet/core/server-only";
import { tenantScopeId } from "@beignet/core/ports";
import { useCase } from "@/lib/use-case";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { CanvasCommandSchema, CanvasCommandOutputSchema } from "../editing";
import { authorizeCanvas } from "../lib/authorize-canvas";

export const canvasCommandUseCase = useCase
	.command("canvases.agentCommand")
	.input(CanvasCommandSchema)
	.output(CanvasCommandOutputSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		await authorizeCanvas(ctx, input.canvasId, input.action !== "read");
		return ctx.ports.canvasEditing.execute({
			userId: user.id,
			workspaceId: tenantScopeId(requireActiveWorkspaceScope(ctx)),
			command: input,
		});
	});

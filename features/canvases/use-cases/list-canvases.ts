import "@beignet/core/server-only";
import { requireActiveWorkspaceScope } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { ListCanvasesInputSchema, ListCanvasesOutputSchema } from "../schemas";

export const listCanvasesUseCase = useCase
	.query("canvases.list")
	.input(ListCanvasesInputSchema)
	.output(ListCanvasesOutputSchema)
	.run(async ({ ctx, input }) => {
		const scope = requireActiveWorkspaceScope(ctx, input.workspaceId);

		return { items: await ctx.ports.canvases.listStandalone(scope) };
	});

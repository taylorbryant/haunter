import "@beignet/core/server-only";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import {
	CanvasNavigationOutputSchema,
	ListCanvasesInputSchema,
} from "../schemas";

const RECENT_CANVAS_LIMIT = 10;

export const getCanvasNavigationUseCase = useCase
	.query("canvases.getNavigation")
	.input(ListCanvasesInputSchema)
	.output(CanvasNavigationOutputSchema)
	.run(async ({ ctx, input }) => {
		const scope = requireActiveWorkspaceScope(ctx, input.workspaceId);
		const user = requireUser(ctx);
		return ctx.ports.canvasNavigation.listForUser(
			scope,
			user.id,
			RECENT_CANVAS_LIMIT,
		);
	});

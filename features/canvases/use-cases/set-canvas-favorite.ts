import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import {
	CanvasIdInputSchema,
	SetCanvasFavoriteBodySchema,
	SetCanvasFavoriteOutputSchema,
} from "../schemas";

const InputSchema = CanvasIdInputSchema.merge(SetCanvasFavoriteBodySchema);

export const setCanvasFavoriteUseCase = useCase
	.command("canvases.setFavorite")
	.input(InputSchema)
	.output(SetCanvasFavoriteOutputSchema)
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

		const favoritedAt = await ctx.ports.canvasNavigation.setFavorite(
			scope,
			user.id,
			canvas.id,
			input.favorite,
		);
		return { canvasId: canvas.id, favoritedAt };
	});

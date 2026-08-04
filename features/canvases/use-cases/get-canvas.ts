import "@beignet/core/server-only";
import { documentCacheEpoch } from "@/features/documents/model";
import { readCollaborativeCanvasProjection } from "@/features/documents/service";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { CanvasDetailSchema, CanvasIdInputSchema } from "../schemas";

export const getCanvasUseCase = useCase
	.query("canvases.get")
	.input(CanvasIdInputSchema)
	.output(CanvasDetailSchema)
	.run(async ({ ctx, input }) => {
		const scope = requireActiveWorkspaceScope(ctx);

		const canvas = await ctx.ports.canvases.findById(scope, input.id);
		if (!canvas) {
			throw appError("CanvasNotFound", { details: { id: input.id } });
		}

		await ctx.gate.authorize("canvases.read", canvas);
		const page = await ctx.ports.pages.findMetaById(scope, canvas.pageId);
		if (!page || page.deletedAt !== null) {
			throw appError("CanvasNotFound", { details: { id: input.id } });
		}
		let result = canvas;
		try {
			const projection = await readCollaborativeCanvasProjection({
				scope,
				entityId: canvas.id,
				ports: ctx.ports,
			});
			result = { ...canvas, snapshot: projection };
		} catch (error) {
			ctx.ports.logger.warn(
				"Serving a stale read-only canvas projection while the document store is unavailable",
				{ error, canvasId: canvas.id },
			);
		}

		const registered = await ctx.ports.documents.findByEntity(
			scope,
			"canvas",
			canvas.id,
		);
		return {
			...result,
			documentCacheEpoch: registered ? documentCacheEpoch(registered) : null,
		};
	});

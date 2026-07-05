import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { useCase } from "@/lib/use-case";
import { SharedCanvasInputSchema, SharedCanvasSchema } from "../schemas";

/**
 * Public read of a canvas embedded in a shared page. The share token is the
 * authorization, and it only reaches canvases that live on the shared page
 * itself — a token never unlocks the rest of the workspace.
 */
export const getSharedCanvasUseCase = useCase
	.query("shares.getSharedCanvas")
	.input(SharedCanvasInputSchema)
	.output(SharedCanvasSchema)
	.run(async ({ ctx, input }) => {
		const share = await ctx.ports.shares.findByToken(input.token);
		if (!share) {
			throw appError("ShareNotFound");
		}

		// Both lookups depend only on the share row, so run them together.
		const [page, canvas] = await Promise.all([
			ctx.ports.pages.findMetaById(share.pageId),
			ctx.ports.canvases.findById(input.id),
		]);
		if (!page || page.deletedAt !== null) {
			throw appError("ShareNotFound");
		}

		if (!canvas || canvas.pageId !== share.pageId) {
			throw appError("ShareNotFound");
		}

		return { snapshot: canvas.snapshot };
	});

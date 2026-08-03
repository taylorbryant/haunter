import "@beignet/core/server-only";
import { createTenant, createTenantScope } from "@beignet/core/ports";
import { isDocumentStoreUnavailable } from "@/features/documents/errors";
import { readCollaborativeCanvasProjection } from "@/features/documents/service";
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

		// The persisted capability, not request input, establishes this scope.
		const scope = createTenantScope(createTenant(share.workspaceId));
		// Both lookups depend only on the share row, so run them together.
		const [page, canvas] = await Promise.all([
			ctx.ports.pages.findMetaById(scope, share.pageId),
			ctx.ports.canvases.findById(scope, input.id),
		]);
		if (!page || page.deletedAt !== null) {
			throw appError("ShareNotFound");
		}

		if (!canvas || canvas.pageId !== share.pageId) {
			throw appError("ShareNotFound");
		}

		let snapshot = canvas.snapshot;
		try {
			snapshot = await readCollaborativeCanvasProjection({
				scope,
				entityId: canvas.id,
				ports: ctx.ports,
			});
		} catch (error) {
			if (!isDocumentStoreUnavailable(error)) throw error;
			ctx.ports.logger.warn(
				"Serving a stale shared-canvas projection while the document store is unavailable",
				{ canvasId: canvas.id, error },
			);
		}

		return { snapshot };
	});

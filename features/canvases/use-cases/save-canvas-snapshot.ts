import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import {
	SaveCanvasSnapshotInputSchema,
	SaveCanvasSnapshotOutputSchema,
} from "../schemas";

/** Fence stale clients: whole-snapshot saves cannot coexist with CRDT writers. */
export const saveCanvasSnapshotUseCase = useCase
	.command("canvases.saveSnapshot")
	.input(SaveCanvasSnapshotInputSchema)
	.output(SaveCanvasSnapshotOutputSchema)
	.run(async ({ ctx, input }) => {
		const scope = requireActiveWorkspaceScope(ctx);
		const canvas = await ctx.ports.canvases.findById(scope, input.id);
		if (!canvas) throw appError("CanvasNotFound");
		await ctx.gate.authorize("canvases.update", canvas);
		if (canvas.pageId) {
			const page = await ctx.ports.pages.findMetaById(scope, canvas.pageId);
			if (!page || page.deletedAt !== null) throw appError("CanvasNotFound");
		}
		throw appError("StaleWrite", {
			message:
				"This editor version can no longer save drawings. Preserve unsynced work, then reload the app.",
		});
	});

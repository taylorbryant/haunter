import "@beignet/core/server-only";
import { replaceCanvasSnapshot } from "@/features/documents/codec";
import { mutateCollaborativeDocument } from "@/features/documents/service";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import {
	SaveCanvasSnapshotInputSchema,
	SaveCanvasSnapshotOutputSchema,
} from "../schemas";

export const saveCanvasSnapshotUseCase = useCase
	.command("canvases.saveSnapshot")
	.input(SaveCanvasSnapshotInputSchema)
	.output(SaveCanvasSnapshotOutputSchema)
	.run(async ({ ctx, input }) => {
		const scope = requireActiveWorkspaceScope(ctx);
		const canvas = await ctx.ports.canvases.findById(scope, input.id);
		if (!canvas) {
			throw appError("CanvasNotFound", { details: { id: input.id } });
		}
		await ctx.gate.authorize("canvases.update", canvas);
		const page = await ctx.ports.pages.findMetaById(scope, canvas.pageId);
		if (!page || page.deletedAt !== null) {
			throw appError("CanvasNotFound", { details: { id: input.id } });
		}

		const result = await mutateCollaborativeDocument({
			scope,
			kind: "canvas",
			entityId: canvas.id,
			ports: ctx.ports,
			apply(doc) {
				replaceCanvasSnapshot(doc, input.snapshot);
			},
		});
		if (result.kind !== "canvas") {
			throw new Error(`Expected a canvas projection for ${canvas.id}`);
		}
		return { updatedAt: result.updatedAt };
	});

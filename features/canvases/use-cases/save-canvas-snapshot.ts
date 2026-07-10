import "@beignet/core/server-only";
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

		return ctx.ports.uow.transaction(async (tx) => {
			const canvas = await tx.canvases.findById(scope, input.id);
			if (!canvas) {
				throw appError("CanvasNotFound", { details: { id: input.id } });
			}

			await ctx.gate.authorize("canvases.update", canvas);
			const page = await tx.pages.findMetaById(scope, canvas.pageId);
			if (!page || page.deletedAt !== null) {
				throw appError("CanvasNotFound", { details: { id: input.id } });
			}

			// Refuse to clobber a newer snapshot when the client provides its
			// last-seen updatedAt (another member or tab drew since).
			const snapshotJson = JSON.stringify(input.snapshot);
			const result = input.baseUpdatedAt
				? await tx.canvases.saveSnapshotIf(
						scope,
						input.id,
						snapshotJson,
						input.baseUpdatedAt,
					)
				: await tx.canvases.saveSnapshot(scope, input.id, snapshotJson);
			if (result === null) {
				throw appError("StaleWrite", { details: { id: input.id } });
			}

			return result;
		});
	});

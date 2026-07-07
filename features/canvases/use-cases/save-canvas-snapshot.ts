import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireUser } from "@/lib/auth";
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
		requireUser(ctx);

		return ctx.ports.uow.transaction(async (tx) => {
			const canvas = await tx.canvases.findById(input.id);
			if (!canvas) {
				throw appError("CanvasNotFound", { details: { id: input.id } });
			}

			await ctx.gate.authorize("canvases.update", canvas);
			const page = await tx.pages.findMetaById(canvas.pageId);
			if (
				!page ||
				page.deletedAt !== null ||
				page.workspaceId !== canvas.workspaceId
			) {
				throw appError("CanvasNotFound", { details: { id: input.id } });
			}

			// Refuse to clobber a newer snapshot when the client provides its
			// last-seen updatedAt (another member or tab drew since).
			const snapshotJson = JSON.stringify(input.snapshot);
			const result = input.baseUpdatedAt
				? await tx.canvases.saveSnapshotIf(
						input.id,
						snapshotJson,
						input.baseUpdatedAt,
					)
				: await tx.canvases.saveSnapshot(input.id, snapshotJson);
			if (result === null) {
				throw appError("StaleWrite", { details: { id: input.id } });
			}

			return result;
		});
	});

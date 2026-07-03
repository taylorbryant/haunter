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

			return tx.canvases.saveSnapshot(input.id, JSON.stringify(input.snapshot));
		});
	});

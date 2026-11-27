import "@beignet/core/server-only";
import { useCase } from "@/lib/use-case";
import { authorizeCanvas } from "../lib/authorize-canvas";
import { CanvasIdInputSchema, CanvasListItemSchema } from "../schemas";

export const getCanvasMetadataUseCase = useCase
	.query("canvases.getMetadata")
	.input(CanvasIdInputSchema)
	.output(CanvasListItemSchema)
	.run(({ ctx, input }) => authorizeCanvas(ctx, input.id, false));

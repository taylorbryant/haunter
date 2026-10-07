import "@beignet/core/server-only";
import { useCase } from "@/lib/use-case";
import {
	InsertCanvasImageInputSchema,
	CanvasEditOutputSchema,
} from "../editing";
import { authorizeCanvas } from "../lib/authorize-canvas";
import { canvasCommandUseCase } from "./edit-canvas";

export const insertCanvasImageUseCase = useCase
	.command("canvases.insertImage")
	.input(InsertCanvasImageInputSchema)
	.output(CanvasEditOutputSchema)
	.run(async ({ ctx, input: { file, inlineFile, ...placement } }) => {
		await authorizeCanvas(ctx, placement.canvasId, true);
		const image = await ctx.ports.agentFiles.read(
			{ file, inlineFile },
			{ imageOnly: true },
		);
		return CanvasEditOutputSchema.parse(
			await canvasCommandUseCase.run({
				ctx,
				input: {
					...placement,
					action: "insert-image",
					image: {
						name: image.name,
						mimeType: "image/png",
						data: Buffer.from(image.bytes).toString("base64"),
						width: image.width!,
						height: image.height!,
					},
				},
			}),
		);
	});

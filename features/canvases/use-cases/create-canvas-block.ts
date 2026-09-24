import "@beignet/core/server-only";
import { z } from "zod";
import { useCase } from "@/lib/use-case";
import { requireUser } from "@/lib/auth";
import {
	PageEditOutputSchema,
	PageRevisionSchema,
} from "@/features/pages/block-editing";
import { writePageDocument } from "@/features/pages/lib/write-page-document";
import { canvasRevision } from "../editing";

export const createCanvasBlockUseCase = useCase
	.command("canvases.createBlock")
	.input(
		z
			.object({ pageId: z.uuid(), expectedRevision: PageRevisionSchema })
			.strict(),
	)
	.output(
		PageEditOutputSchema.extend({
			canvasId: z.uuid(),
			canvasRevision: z.string(),
		}),
	)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		await ctx.gate.authorize("canvases.create");
		let canvasId = "";
		const result = await writePageDocument(
			ctx,
			{ id: input.pageId, expectedRevision: input.expectedRevision },
			async (tx, scope) => {
				const canvas = await tx.canvases.create(scope, {
					userId: user.id,
					pageId: input.pageId,
					title: null,
				});
				canvasId = canvas.id;
				const blockId = crypto.randomUUID();
				const saved = await tx.documents.appendBlocks(scope, input.pageId, [
					{ id: blockId, type: "canvas", props: { canvasId }, children: [] },
				]);
				const document = await tx.documents.find(scope, input.pageId);
				if (!document) throw new Error("Page document disappeared");
				return {
					...saved,
					generation: document.generation,
					insertedBlockIds: [blockId],
				};
			},
		);
		return { ...result, canvasId, canvasRevision: canvasRevision(canvasId, 0) };
	});

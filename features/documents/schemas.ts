import { z } from "zod";

export const DocumentKindSchema = z.enum(["page", "canvas"]);
export const DocumentPathSchema = z.object({
	kind: DocumentKindSchema,
	id: z.string().uuid(),
});
export const TaskMaterializationAttributionSchema = z.object({
	blockId: z.string().min(1).max(200),
	assignee: z.string().min(1).max(200),
});
export const QueueDocumentMaterializationBodySchema = z.object({
	taskAttributions: z
		.array(TaskMaterializationAttributionSchema)
		.max(100)
		.optional(),
});
export const QueueDocumentMaterializationInputSchema = DocumentPathSchema.merge(
	QueueDocumentMaterializationBodySchema,
);
export const QueueDocumentMaterializationOutputSchema = z.object({
	queued: z.literal(true),
});

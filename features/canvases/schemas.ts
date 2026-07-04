import { z } from "zod";

/**
 * A persisted tldraw document snapshot (`getSnapshot(store).document`).
 * Opaque to the server: shape-checked as a JSON object, stored verbatim.
 */
export const CanvasSnapshotSchema = z.record(z.string(), z.unknown());

export const CanvasSchema = z.object({
	id: z.string().uuid(),
	userId: z.string(),
	workspaceId: z.string().min(1),
	pageId: z.string().uuid(),
	snapshot: CanvasSnapshotSchema,
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});

export const CanvasIdInputSchema = z.object({
	id: z.string().uuid(),
});

export const CreateCanvasInputSchema = z.object({
	workspaceId: z.string().min(1),
	pageId: z.string().uuid(),
});

export const SaveCanvasSnapshotBodySchema = z.object({
	snapshot: CanvasSnapshotSchema,
});

export const SaveCanvasSnapshotInputSchema = CanvasIdInputSchema.merge(
	SaveCanvasSnapshotBodySchema,
);

export const SaveCanvasSnapshotOutputSchema = z.object({
	updatedAt: z.string().datetime(),
});

export type Canvas = z.infer<typeof CanvasSchema>;
export type CanvasSnapshot = z.infer<typeof CanvasSnapshotSchema>;
export type CreateCanvasInput = z.infer<typeof CreateCanvasInputSchema>;

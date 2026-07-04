import { z } from "zod";
import { CanvasSnapshotSchema } from "@/features/canvases/schemas";
import { PageContentSchema } from "@/features/pages/schemas";

export const PageShareSchema = z.object({
	id: z.string().uuid(),
	pageId: z.string().uuid(),
	workspaceId: z.string().min(1),
	/** Unguessable capability; knowing it grants read access to the page. */
	token: z.string().min(1),
	createdBy: z.string(),
	createdAt: z.string().datetime(),
});

export const PageIdInputSchema = z.object({
	pageId: z.string().uuid(),
});

export const GetPageShareOutputSchema = z.object({
	share: PageShareSchema.nullable(),
});

export const SharedTokenInputSchema = z.object({
	token: z.string().min(1),
});

/** The public read model: page content only, no ids beyond what's needed. */
export const SharedPageSchema = z.object({
	title: z.string(),
	icon: z.string().nullable(),
	content: PageContentSchema,
	updatedAt: z.string().datetime(),
});

export const SharedCanvasInputSchema = z.object({
	token: z.string().min(1),
	id: z.string().uuid(),
});

/** Snapshot-only read model for canvases embedded in a shared page. */
export const SharedCanvasSchema = z.object({
	snapshot: CanvasSnapshotSchema,
});

export type PageShare = z.infer<typeof PageShareSchema>;
export type SharedPage = z.infer<typeof SharedPageSchema>;

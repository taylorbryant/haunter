import { z } from "zod";
import { PageListSchema } from "./schemas";
import { PAGE_TITLE_MAX_LENGTH } from "@/features/pages/schemas";

export const EmbeddedWorkspaceInputSchema = z.object({
	workspaceId: z.string().min(1),
});
export const WorkspaceActionSchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("create-page"),
		title: z.string().max(PAGE_TITLE_MAX_LENGTH),
		parentPageId: z.uuid().optional(),
		atCursor: z.boolean().optional(),
	}),
	z.object({
		action: z.literal("create-canvas"),
		title: z.string().max(200).optional(),
		pageId: z.uuid().optional(),
	}),
	z.object({
		action: z.literal("move-page"),
		pageId: z.uuid(),
		parentPageId: z.uuid().nullable(),
	}),
	z.object({ action: z.literal("archive-page"), pageId: z.uuid() }),
	z.object({ action: z.literal("restore-page"), pageId: z.uuid() }),
	z.object({
		action: z.literal("favorite-page"),
		pageId: z.uuid(),
		favorite: z.boolean(),
	}),
	z.object({
		action: z.literal("favorite-canvas"),
		canvasId: z.uuid(),
		favorite: z.boolean(),
	}),
]);
export type WorkspaceAction = z.infer<typeof WorkspaceActionSchema>;
export const EmbeddedWorkspaceActionSchema =
	EmbeddedWorkspaceInputSchema.extend({ operation: WorkspaceActionSchema });
export const WorkspaceActionResultSchema = z.object({ id: z.uuid() });
export const EmbeddedWorkspaceSchema = PageListSchema.extend({
	canEdit: z.boolean(),
	favorites: z.array(z.uuid()),
	canvasFavorites: z.array(z.uuid()),
	canvases: z.array(z.object({ id: z.uuid(), title: z.string().nullable() })),
});
export type EmbeddedWorkspace = z.infer<typeof EmbeddedWorkspaceSchema>;

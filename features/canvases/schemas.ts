import { z } from "zod";

/**
 * A persisted tldraw document snapshot (`getSnapshot(store).document`).
 * Opaque to the server: shape-checked as a JSON object, stored verbatim.
 */
export const CanvasSnapshotSchema = z.record(z.string(), z.unknown());

export const CANVAS_TITLE_MAX_LENGTH = 1_000;
export const CANVAS_TITLE_TOO_LONG_MESSAGE =
	"Canvas titles can be up to 1,000 characters.";

const CanvasTitleInputSchema = z
	.string()
	.trim()
	.min(1)
	.max(CANVAS_TITLE_MAX_LENGTH, { message: CANVAS_TITLE_TOO_LONG_MESSAGE });

export const CanvasSchema = z.object({
	id: z.string().uuid(),
	userId: z.string(),
	workspaceId: z.string().min(1),
	pageId: z.string().uuid().nullable(),
	title: z.string().nullable(),
	snapshot: CanvasSnapshotSchema,
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});

export const CanvasIdInputSchema = z.object({
	id: z.string().uuid(),
});

export const CreateCanvasInputSchema = z
	.object({
		workspaceId: z.string().min(1),
		pageId: z.string().uuid().optional(),
		title: CanvasTitleInputSchema.optional(),
	})
	.refine((input) => input.pageId !== undefined || input.title !== undefined, {
		message: "A standalone canvas requires a title",
		path: ["title"],
	});

export const CanvasListItemSchema = CanvasSchema.omit({ snapshot: true });

export const CanvasNavigationItemSchema = CanvasListItemSchema.extend({
	favoritedAt: z.string().datetime().nullable(),
	lastViewedAt: z.string().datetime().nullable(),
});

export const CanvasNavigationOutputSchema = z.object({
	favorites: z.array(CanvasNavigationItemSchema),
	recents: z.array(CanvasNavigationItemSchema),
});

export const SetCanvasFavoriteBodySchema = z.object({
	favorite: z.boolean(),
});

export const SetCanvasFavoriteOutputSchema = z.object({
	canvasId: z.string().uuid(),
	favoritedAt: z.string().datetime().nullable(),
});

export const RecordCanvasViewOutputSchema = z.object({
	canvasId: z.string().uuid(),
	lastViewedAt: z.string().datetime(),
});

export const ListCanvasesInputSchema = z.object({
	workspaceId: z.string().min(1),
});

export const ListCanvasesOutputSchema = z.object({
	items: z.array(CanvasListItemSchema),
});

export const UpdateCanvasBodySchema = z.object({
	title: CanvasTitleInputSchema,
});

export const UpdateCanvasInputSchema = CanvasIdInputSchema.merge(
	UpdateCanvasBodySchema,
);

export const DeleteCanvasOutputSchema = z.void();

export const SaveCanvasSnapshotBodySchema = z.object({
	snapshot: CanvasSnapshotSchema,
	// Optimistic-concurrency precondition, as on page content saves.
	baseUpdatedAt: z.string().datetime().optional(),
});

export const SaveCanvasSnapshotInputSchema = CanvasIdInputSchema.merge(
	SaveCanvasSnapshotBodySchema,
);

export const SaveCanvasSnapshotOutputSchema = z.object({
	updatedAt: z.string().datetime(),
});

export type Canvas = z.infer<typeof CanvasSchema>;
export type CanvasListItem = z.infer<typeof CanvasListItemSchema>;
export type CanvasNavigationItem = z.infer<typeof CanvasNavigationItemSchema>;
export type CanvasNavigationOutput = z.infer<
	typeof CanvasNavigationOutputSchema
>;
export type CanvasSnapshot = z.infer<typeof CanvasSnapshotSchema>;
export type CreateCanvasInput = z.infer<typeof CreateCanvasInputSchema>;

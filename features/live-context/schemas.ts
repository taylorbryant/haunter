import { z } from "zod";

export const LIVE_CONTEXT_TTL_MS = 120_000;
export const LIVE_CONTEXT_REPORT_MAX_AGE_MS = 120_000;
export const LIVE_CONTEXT_CLOCK_SKEW_MS = 30_000;
// Keep ordering state until any older report's acceptance window has closed.
export const LIVE_CONTEXT_SEQUENCE_TTL_MS = Math.max(
	LIVE_CONTEXT_TTL_MS,
	LIVE_CONTEXT_REPORT_MAX_AGE_MS + LIVE_CONTEXT_CLOCK_SKEW_MS,
);
export const LIVE_CONTEXT_STALE_MS = 45_000;
export const LIVE_CONTEXT_MAX_SESSIONS = 20;
export const LIVE_CONTEXT_MAX_SHAPES = 100;

export const CanvasSelectionSchema = z
	.object({
		canvasId: z.uuid(),
		canvasPageId: z
			.string()
			.regex(/^page:.+/)
			.max(200)
			.nullable(),
		selectedShapeIds: z
			.array(
				z
					.string()
					.regex(/^shape:.+/)
					.max(200),
			)
			.max(LIVE_CONTEXT_MAX_SHAPES),
		selectionCount: z.number().int().min(0).max(30_000),
	})
	.refine(
		(value) =>
			value.selectionCount >= value.selectedShapeIds.length &&
			new Set(value.selectedShapeIds).size === value.selectedShapeIds.length,
	);

export const ActiveViewSchema = z
	.object({
		pageId: z.uuid().nullable(),
		canvas: CanvasSelectionSchema.nullable(),
	})
	.refine((value) => value.pageId !== null || value.canvas !== null);

export const WorkspaceContextInputSchema = z.object({
	workspaceId: z.string().min(1).max(200),
});
export const GetActiveContextInputSchema = WorkspaceContextInputSchema.extend({
	sessionId: z.uuid(),
});
export const PublishContextInputSchema = GetActiveContextInputSchema.extend({
	// An identity assertion prevents an old tab publishing under newly changed cookies.
	expectedUserId: z.string().min(1).max(200),
	sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
	reportedAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
	visible: z.boolean(),
	focused: z.boolean(),
	contextAgeMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
	view: ActiveViewSchema.nullable(),
});

export const StoredContextSchema = PublishContextInputSchema.omit({
	expectedUserId: true,
	contextAgeMs: true,
	reportedAt: true,
}).extend({
	capturedAt: z.number(),
	lastSeenAt: z.number(),
	expiresAt: z.number(),
});
export const ActiveContextSchema = StoredContextSchema.omit({
	view: true,
}).extend({
	view: ActiveViewSchema,
	pageTitle: z.string().nullable(),
	canvasTitle: z.string().nullable(),
	stale: z.boolean(),
	selectionComplete: z.boolean(),
});
export const ActiveSessionSchema = ActiveContextSchema.omit({
	view: true,
}).extend({
	pageId: z.uuid().nullable(),
	canvasId: z.uuid().nullable(),
	canvasPageId: z.string().nullable(),
	selectionCount: z.number().int().nonnegative(),
});
export const ListActiveSessionsOutputSchema = z.object({
	sessions: z.array(ActiveSessionSchema),
});
export const GetActiveContextOutputSchema = z.object({
	context: ActiveContextSchema,
});
export const PublishContextOutputSchema = z.object({ accepted: z.boolean() });
export type CanvasSelection = z.infer<typeof CanvasSelectionSchema>;
export type ActiveView = z.infer<typeof ActiveViewSchema>;
export type PublishContextInput = z.infer<typeof PublishContextInputSchema>;
export type StoredContext = z.infer<typeof StoredContextSchema>;
export type ActiveContext = z.infer<typeof ActiveContextSchema>;

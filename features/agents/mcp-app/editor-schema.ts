import { z } from "zod";
import { ContextPageSchema, workspacePathSegment } from "./schemas";

export { COMPANION_URI as EDITOR_URI } from "./schemas";
export const MAX_SELECTION_CHARACTERS = 12_000;
export const EditorInputSchema = ContextPageSchema.pick({
	workspaceId: true,
	pageId: true,
});
export const PageEditorOutputSchema = EditorInputSchema.extend({
	canvasId: z.never().optional(),
	title: z.string(),
	editorUrl: z.url(),
	webUrl: z.url(),
});
export const CanvasEditorInputSchema = z.object({
	workspaceId: z.string().min(1),
	canvasId: z.uuid(),
});
export const CanvasEditorOutputSchema = CanvasEditorInputSchema.extend({
	pageId: z.uuid().nullable(),
	title: z.string(),
	editorUrl: z.url(),
	webUrl: z.url(),
});
export const EditorOutputSchema = z.union([
	CanvasEditorOutputSchema,
	PageEditorOutputSchema,
]);
export type PageEditorOutput = z.infer<typeof PageEditorOutputSchema>;
export type EditorOutput = z.infer<typeof EditorOutputSchema>;

export const CanvasSelectionSchema = z
	.object({
		canvasPageId: z
			.string()
			.regex(/^page:.+/)
			.max(200),
		selectedShapeIds: z
			.array(
				z
					.string()
					.regex(/^shape:.+/)
					.max(200),
			)
			.max(100),
		selectionCount: z.number().int().nonnegative(),
		selectionComplete: z.boolean(),
	})
	.refine(
		(value) =>
			value.selectionCount >= value.selectedShapeIds.length &&
			value.selectionComplete ===
				(value.selectionCount === value.selectedShapeIds.length),
	);
export type CanvasSelection = z.infer<typeof CanvasSelectionSchema>;
export const EditorWorkspaceRequestSchema = z.discriminatedUnion("action", [
	z.object({ action: z.literal("list-pages") }),
	z.object({ action: z.literal("create-page") }),
	z.object({ action: z.literal("create-canvas") }),
]);
export type EditorWorkspaceRequest = z.infer<
	typeof EditorWorkspaceRequestSchema
>;
export const EditorMessageSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("haunter/editor/workspace-request"),
		nonce: z.string(),
		requestId: z.uuid(),
		request: EditorWorkspaceRequestSchema,
	}),
	z.object({
		type: z.literal("haunter/editor/canvas-selection"),
		nonce: z.string(),
		selection: CanvasSelectionSchema,
	}),
	z
		.object({
			type: z.literal("haunter/editor/inline-canvas-selection"),
			nonce: z.string(),
			canvasId: z.uuid().nullable(),
			selection: CanvasSelectionSchema.nullable(),
		})
		.refine(
			(value) => (value.canvasId === null) === (value.selection === null),
		),
	z.object({
		type: z.literal("haunter/editor/open-canvas"),
		nonce: z.string(),
		canvasId: z.uuid(),
	}),
	z.object({
		type: z.literal("haunter/editor/open-page"),
		nonce: z.string(),
		workspaceId: z.string().min(1).optional(),
		pageId: z.uuid(),
	}),
	z.object({
		type: z.literal("haunter/editor/save-status"),
		nonce: z.string(),
		status: z.enum(["unknown", "saved", "unsaved"]),
	}),
	z.object({
		type: z.literal("haunter/editor/metadata"),
		nonce: z.string(),
		title: z.string().max(10000),
		icon: z.string().nullable(),
	}),
	z.object({
		type: z.literal("haunter/editor/authorize"),
		nonce: z.string(),
		requestId: z.uuid(),
		challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
	}),
	z.object({
		type: z.literal("haunter/editor/status"),
		nonce: z.string(),
		status: z.enum(["opening", "ready", "sign-in-required", "access-denied"]),
	}),
	z.object({ type: z.literal("haunter/editor/open-web"), nonce: z.string() }),
	z.object({
		type: z.literal("haunter/editor/flushed"),
		requestId: z.uuid(),
		nonce: z.string(),
		locallySaved: z.boolean(),
		saved: z.boolean(),
	}),
	z.object({
		type: z.literal("haunter/editor/selection"),
		nonce: z.string(),
		text: z.string().trim().max(MAX_SELECTION_CHARACTERS),
		complete: z.boolean().default(true),
	}),
]);

export function editorPaths(workspaceId: string, pageId: string) {
	EditorInputSchema.parse({ workspaceId, pageId });
	const webPath = `/w/${workspacePathSegment(workspaceId)}/p/${pageId}`;
	return { webPath, editorPath: `/embed${webPath}` };
}

export function canvasEditorPaths(workspaceId: string, canvasId: string) {
	CanvasEditorInputSchema.parse({ workspaceId, canvasId });
	const webPath = `/w/${workspacePathSegment(workspaceId)}/c/${canvasId}`;
	return { webPath, editorPath: `/embed${webPath}` };
}
/** URLs come from the server, and still have to match the intended page. */
export function validateEditorOutput(input: unknown) {
	const output = EditorOutputSchema.parse(input);
	const editor = new URL(output.editorUrl);
	const web = new URL(output.webUrl);
	const paths = output.canvasId
		? canvasEditorPaths(output.workspaceId, output.canvasId)
		: editorPaths(output.workspaceId, output.pageId!);
	if (
		!["https:", "http:"].includes(editor.protocol) ||
		(editor.protocol === "http:" &&
			!["localhost", "127.0.0.1"].includes(editor.hostname)) ||
		editor.username ||
		editor.password ||
		web.username ||
		web.password ||
		editor.origin !== web.origin ||
		editor.pathname !== paths.editorPath ||
		web.pathname !== paths.webPath ||
		editor.search ||
		editor.hash ||
		web.search ||
		web.hash
	)
		throw new Error("Haunter returned an invalid editor destination.");
	return output;
}

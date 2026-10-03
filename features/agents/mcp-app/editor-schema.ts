import { z } from "zod";
import { ContextPageSchema, pageResourceUri } from "./schemas";

export { COMPANION_URI as EDITOR_URI } from "./schemas";
export const MAX_SELECTION_CHARACTERS = 12_000;
export const EditorInputSchema = ContextPageSchema.pick({
	workspaceId: true,
	pageId: true,
});
export const EditorOutputSchema = EditorInputSchema.extend({
	title: z.string(),
	editorUrl: z.url(),
	webUrl: z.url(),
});
export type EditorOutput = z.infer<typeof EditorOutputSchema>;

export const EditorMessageSchema = z.discriminatedUnion("type", [
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
		status: z.enum(["ready", "sign-in-required", "access-denied"]),
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
		text: z.string().trim().min(1).max(MAX_SELECTION_CHARACTERS),
	}),
]);

export function editorPaths(workspaceId: string, pageId: string) {
	EditorInputSchema.parse({ workspaceId, pageId });
	const webPath = `/w/${encodeURIComponent(workspaceId)}/p/${pageId}`;
	return { webPath, editorPath: `/embed${webPath}` };
}

/** URLs come from the server, and still have to match the intended page. */
export function validateEditorOutput(input: unknown) {
	const output = EditorOutputSchema.parse(input);
	const editor = new URL(output.editorUrl);
	const web = new URL(output.webUrl);
	const paths = editorPaths(output.workspaceId, output.pageId);
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

export function selectionContextText(page: EditorOutput, text: string) {
	return [
		`Selected text from Haunter: ${page.title}`,
		`Source: ${pageResourceUri(page.workspaceId, page.pageId)}`,
		"Live editor selection; may include changes that have not been saved yet.",
		"",
		text.slice(0, MAX_SELECTION_CHARACTERS),
	].join("\n");
}

import { type Editor, react } from "tldraw";
import type { LiveContextTracker } from "@/features/live-context/client/tracker";
import { readCanvasTextEditing } from "./text-context";

/** Observe instance state (selection/current page), never write it to the
 * shared document. An unfocused canvas cannot steal another canvas's context. */
export function observeCanvasContext(
	editor: Editor,
	tracker: LiveContextTracker,
	identity: { workspaceId: string; pageId: string | null; canvasId: string },
) {
	const container = editor.getContainer();
	container.setAttribute("data-live-context-canvas", identity.canvasId);
	const report = (activate: boolean) => {
		const selectedShapeIds = editor.getSelectedShapeIds();
		tracker.canvas(
			identity.workspaceId,
			identity.pageId,
			{
				canvasId: identity.canvasId,
				canvasPageId: editor.getCurrentPageId(),
				selectedShapeIds: [...selectedShapeIds],
				selectionCount: selectedShapeIds.length,
				textEditing: readCanvasTextEditing(editor),
			},
			activate,
		);
	};
	const activate = () => report(true);
	const textChanged = () => report(editor.getInstanceState().isFocused);
	let textEditor: ReturnType<Editor["getRichTextEditor"]> = null;
	const detachTextEditor = () => {
		textEditor?.off("transaction", textChanged);
		textEditor?.off("unmount", textChanged);
	};
	const stop = react("Haunter live canvas context", () => {
		const next = editor.getRichTextEditor();
		if (next !== textEditor) {
			detachTextEditor();
			textEditor = next;
			// Transactions cover cursor movement and text edits. Neither changes
			// tldraw instance state, so its reactive observer alone is insufficient.
			textEditor?.on("transaction", textChanged);
			textEditor?.on("unmount", textChanged);
		}
		report(editor.getInstanceState().isFocused);
	});
	container.addEventListener("pointerdown", activate, true);
	container.addEventListener("focusin", activate, true);
	if (identity.pageId === null) report(true);
	return () => {
		stop();
		detachTextEditor();
		container.removeEventListener("pointerdown", activate, true);
		container.removeEventListener("focusin", activate, true);
		container.removeAttribute("data-live-context-canvas");
		tracker.clearCanvas(identity.canvasId);
	};
}

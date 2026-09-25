import { type Editor, react } from "tldraw";
import type { LiveContextTracker } from "@/features/live-context/client/tracker";

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
			},
			activate,
		);
	};
	const activate = () => report(true);
	const stop = react("Haunter live canvas context", () =>
		report(editor.getInstanceState().isFocused),
	);
	container.addEventListener("pointerdown", activate, true);
	container.addEventListener("focusin", activate, true);
	if (identity.pageId === null) report(true);
	return () => {
		stop();
		container.removeEventListener("pointerdown", activate, true);
		container.removeEventListener("focusin", activate, true);
		container.removeAttribute("data-live-context-canvas");
		tracker.clearCanvas(identity.canvasId);
	};
}

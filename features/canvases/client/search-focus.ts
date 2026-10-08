import { react, type Editor, type TLShapeId } from "tldraw";

/** Wait for sync, then change selection outside the reactive read cycle. */
export function observeCanvasSearchResult(editor: Editor, shapeId: string) {
	let stopped = false;
	let queued = false;
	let applied = false;
	const stop = react("Focus canvas search result", () => {
		if (applied) return;
		const shape = editor.getShape(shapeId as TLShapeId);
		if (!shape || !editor.getAncestorPageId(shape) || queued) return;
		queued = true;
		queueMicrotask(() => {
			queued = false;
			if (stopped) return;
			// Selection and camera writes can synchronously rerun tldraw effects.
			// Keep them outside dependency capture and apply each link only once.
			applied = true;
			applied = focusCanvasSearchResult(editor, shapeId);
		});
	});
	return () => {
		stopped = true;
		stop();
	};
}

/** Called again if a search result arrives before its shape has synced. */
export function focusCanvasSearchResult(
	editor: Editor,
	shapeId: string,
): boolean {
	const shape = editor.getShape(shapeId as TLShapeId);
	const page = shape && editor.getAncestorPageId(shape);
	if (!shape || !page) return false;
	editor.setCurrentPage(page);
	editor.select(shape.id);
	const bounds = editor.getSelectionPageBounds();
	if (bounds) editor.zoomToBounds(bounds, { targetZoom: 1 });
	return true;
}

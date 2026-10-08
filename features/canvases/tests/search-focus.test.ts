import { expect, test } from "bun:test";
import type { TLShapeId, TLPageId } from "tldraw";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import { normalizeCanvasSnapshot } from "../lib/document";
import {
	focusCanvasSearchResult,
	observeCanvasSearchResult,
} from "../client/search-focus";

test("search focuses a nested shape on another drawing page without editing the drawing", async () => {
	installTestDom();
	const { Editor, createTLStore, defaultShapeUtils, defaultBindingUtils } =
		await import("tldraw");
	const store = createTLStore({
		shapeUtils: defaultShapeUtils,
		bindingUtils: defaultBindingUtils,
		snapshot: normalizeCanvasSnapshot({}),
	});
	const container = document.createElement("div");
	document.body.append(container);
	const editor = new Editor({
		store,
		shapeUtils: defaultShapeUtils,
		bindingUtils: defaultBindingUtils,
		tools: [],
		getContainer: () => container,
	});
	try {
		const page = "page:other" as TLPageId;
		const frame = "shape:frame" as TLShapeId;
		const shape = "shape:match" as TLShapeId;
		editor.createPage({ id: page, name: "Second page" });
		editor.setCurrentPage(page);
		editor.createShape({ id: frame, type: "frame", x: 1000, y: 1000 });
		editor.createShape({
			id: shape,
			parentId: frame,
			type: "geo",
			x: 20,
			y: 20,
		});
		editor.setCurrentPage("page:page" as TLPageId);
		const before = store.getStoreSnapshot();
		expect(focusCanvasSearchResult(editor, "shape:missing")).toBeFalse();
		expect(editor.getCurrentPageId()).toBe("page:page" as TLPageId);
		expect(focusCanvasSearchResult(editor, shape)).toBeTrue();
		expect(editor.getCurrentPageId()).toBe(page);
		expect(editor.getSelectedShapeIds()).toEqual([shape]);
		expect(store.getStoreSnapshot()).toEqual(before);
		const bounds = editor.getShapePageBounds(shape)!;
		expect(editor.getViewportPageBounds().includes(bounds)).toBeTrue();
		// The live UI waits for sync in a tldraw reaction. Camera/selection writes
		// must happen after that reaction finishes collecting dependencies.
		editor.selectNone();
		const pendingId = "shape:arriving" as TLShapeId;
		const stop = observeCanvasSearchResult(editor, pendingId);
		editor.createShape({ id: pendingId, type: "geo", x: 5000, y: 5000 });
		expect(editor.getSelectedShapeIds()).toEqual([]);
		await Promise.resolve();
		expect(editor.getSelectedShapeIds()).toEqual([pendingId]);
		expect(editor.getZoomLevel()).toBeLessThanOrEqual(1);
		expect(
			editor
				.getViewportPageBounds()
				.includes(editor.getShapePageBounds(pendingId)!),
		).toBeTrue();
		editor.select(shape);
		editor.updateShape({ id: pendingId, type: "geo", x: 5100 });
		await Promise.resolve();
		expect(editor.getSelectedShapeIds()).toEqual([shape]);
		stop();
		const cancel = observeCanvasSearchResult(editor, pendingId);
		cancel();
		await Promise.resolve();
		expect(editor.getSelectedShapeIds()).toEqual([shape]);
	} finally {
		editor.dispose();
		container.remove();
		await uninstallTestDom();
	}
});

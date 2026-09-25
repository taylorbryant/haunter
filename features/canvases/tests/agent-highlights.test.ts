import { expect, test } from "bun:test";
import type { TLShapeId, TLPageId } from "tldraw";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import { normalizeCanvasSnapshot } from "../lib/document";

test("agent outlines follow real tldraw rendering without touching selection, history, or the document", async () => {
	installTestDom();
	const { Editor, createTLStore, defaultShapeUtils, defaultBindingUtils } =
		await import("tldraw");
	const { AgentHighlightOverlayUtil, setAgentHighlights } = await import(
		"../client/agent-highlights"
	);
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
		const id = "shape:a" as TLShapeId;
		editor.createShape({ id, type: "geo" });
		editor.createShape({ id: "shape:b" as TLShapeId, type: "geo" });
		editor.select("shape:b" as TLShapeId);
		editor.setHintingShapes(["shape:b" as TLShapeId]);
		editor.markHistoryStoppingPoint();
		editor.updateShape({ id, type: "geo", x: 40 });
		editor.undo();
		expect(editor.getCanRedo()).toBe(true);
		const before = store.getStoreSnapshot();
		const overlay = new AgentHighlightOverlayUtil(editor);
		setAgentHighlights(editor, [id, "shape:missing"]);
		expect(overlay.isActive()).toBe(true);
		expect(overlay.getOverlays()[0].props.shapeIds).toEqual([id]);
		expect(overlay.getGeometry(overlay.getOverlays()[0])).toBeNull();
		expect(editor.getSelectedShapeIds()).toEqual(["shape:b" as TLShapeId]);
		expect(editor.getHintingShapeIds()).toEqual(["shape:b" as TLShapeId]);
		expect(store.getStoreSnapshot()).toEqual(before);
		// Highlighting must preserve the redo stack and leave the next undo
		// targeting the user's shape edit, rather than an activity update.
		expect(editor.getCanRedo()).toBe(true);
		editor.redo();
		expect(editor.getShape(id)?.x).toBe(40);
		editor.undo();
		expect(editor.getShape(id)?.x).toBe(0);
		// An event may arrive before the shape sync. A later shape renders using
		// the same pending IDs, without another event or selection mutation.
		editor.createShape({ id: "shape:missing" as TLShapeId, type: "geo" });
		expect(overlay.getOverlays()[0].props.shapeIds).toContain(
			"shape:missing" as TLShapeId,
		);
		editor.createPage({ id: "page:other" as TLPageId, name: "Other" });
		editor.setCurrentPage("page:other" as TLPageId);
		expect(overlay.getOverlays()).toEqual([]);
		editor.setCurrentPage("page:page" as TLPageId);
		editor.deleteShapes([id]);
		expect(overlay.getOverlays()[0].props.shapeIds).toEqual([
			"shape:missing" as TLShapeId,
		]);
		setAgentHighlights(editor, []);
		expect(overlay.isActive()).toBe(false);
		expect(overlay.getOverlays()).toEqual([]);
	} finally {
		editor.dispose();
		container.remove();
		await uninstallTestDom();
	}
});

import { expect, test } from "bun:test";
import type { TLShapeId, TLPageId } from "tldraw";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import { LiveContextTracker } from "@/features/live-context/client/tracker";
import type { PublishContextInput } from "@/features/live-context/schemas";
import { normalizeCanvasSnapshot } from "../lib/document";

test("native tldraw selections and page changes report context, survive blur, and stop after cleanup", async () => {
	installTestDom();
	const { Editor, createTLStore, defaultShapeUtils, defaultBindingUtils } =
		await import("tldraw");
	const { observeCanvasContext } = await import("../client/live-context");
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
	const calls: PublishContextInput[] = [];
	const tracker = new LiveContextTracker("user", async (input) => {
		calls.push(input);
	});
	const canvasId = crypto.randomUUID();
	tracker.navigate({ workspaceId: "workspace", pageId: null, canvasId });
	const stop = observeCanvasContext(editor, tracker, {
		workspaceId: "workspace",
		pageId: null,
		canvasId,
	});
	try {
		editor.createShape({ id: "shape:a" as TLShapeId, type: "geo" });
		editor.select("shape:a" as TLShapeId);
		await tracker.flush();
		expect(calls.at(-1)?.view?.canvas).toMatchObject({
			canvasPageId: editor.getCurrentPageId(),
			selectedShapeIds: ["shape:a"],
			selectionCount: 1,
		});
		editor.blur();
		tracker.presence(false, false);
		await tracker.flush();
		expect(calls.at(-1)?.view?.canvas?.selectedShapeIds).toEqual(["shape:a"]);
		editor.createPage({ id: "page:second" as TLPageId, name: "Second" });
		editor.setCurrentPage("page:second" as TLPageId);
		await tracker.flush();
		expect(calls.at(-1)?.view?.canvas).toMatchObject({
			canvasPageId: "page:second",
			selectedShapeIds: [],
		});
		stop();
		await tracker.flush();
		const count = calls.length;
		editor.setCurrentPage("page:page" as TLPageId);
		await tracker.flush();
		expect(calls).toHaveLength(count);
		expect(container.hasAttribute("data-live-context-canvas")).toBe(false);
	} finally {
		stop();
		editor.dispose();
		container.remove();
		await uninstallTestDom();
	}
});

import { expect, test } from "bun:test";
import type { TLShape } from "tldraw";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import { canvasFingerprint, normalizeCanvasSnapshot } from "../lib/document";

test("native tldraw undo retains unrelated remote shapes", async () => {
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
		const id = "shape:local" as TLShape["id"],
			remote = "shape:remote" as TLShape["id"];
		editor.createShape({ id, type: "geo", x: 0, y: 0 });
		editor.markHistoryStoppingPoint("move");
		editor.updateShape({ id, type: "geo", x: 50 });
		store.mergeRemoteChanges(() =>
			editor.createShape({ id: remote, type: "geo", x: 300, y: 0 }),
		);
		editor.undo();
		expect(editor.getShape(id)?.x).toBe(0);
		expect(editor.getShape(remote)).toBeDefined();
		editor.redo();
		expect(editor.getShape(id)?.x).toBe(50);
		expect(editor.getShape(remote)).toBeDefined();
	} finally {
		editor.dispose();
		container.remove();
		await uninstallTestDom();
	}
});

test("the navigation guard sees an editor operation before the next animation frame", async () => {
	installTestDom();
	const { Editor, createTLStore, defaultShapeUtils, defaultBindingUtils } =
		await import("tldraw");
	const { CanvasSyncRecovery } = await import("../client/sync-recovery");
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
	let writes = 0;
	const recovery = new CanvasSyncRecovery(
		store,
		{ userId: "user", workspaceId: "workspace", resourceId: "canvas" },
		{
			load: async () => null,
			persist: async () => {
				writes++;
			},
			discard: async () => {},
			acknowledge: async () => null,
		},
		() => {},
	);
	try {
		editor.markHistoryStoppingPoint("create");
		editor.createShape({ id: "shape:immediate" as TLShape["id"], type: "geo" });
		expect(recovery.getSnapshot()).toMatchObject({
			dirty: true,
			locallySaved: false,
		});
		expect(
			recovery.getSnapshot().value.store["shape:immediate" as TLShape["id"]],
		).toBeDefined();
		editor.undo();
		await recovery.flushLocal();
		expect(
			recovery.getSnapshot().value.store["shape:immediate" as TLShape["id"]],
		).toBeUndefined();
		expect(recovery.getSnapshot().locallySaved).toBe(true);
		// Undo may flush an intermediate native diff, so the reversal also needs
		// a durable receipt before the guard can consider it saved.
		recovery.acknowledge(await canvasFingerprint(store.getStoreSnapshot()));
		await recovery.flushLocal();
		expect(recovery.getSnapshot().dirty).toBe(false);
		expect(writes).toBeGreaterThan(0);
	} finally {
		recovery.dispose();
		editor.dispose();
		container.remove();
		await uninstallTestDom();
	}
});

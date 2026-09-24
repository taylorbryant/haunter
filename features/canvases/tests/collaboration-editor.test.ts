import { expect, test } from "bun:test";
import type { TLShape } from "tldraw";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import { canvasFingerprint, normalizeCanvasSnapshot } from "../lib/document";
import { prepareCanvasEdit } from "@/infra/canvases/shape-edits";

test("agent-generated arrows render as native bindings and follow remote node moves", async () => {
	installTestDom();
	const {
		Editor,
		createTLStore,
		defaultShapeUtils,
		defaultBindingUtils,
		getArrowInfo,
	} = await import("tldraw");
	const edit = prepareCanvasEdit(normalizeCanvasSnapshot({}), {
		action: "edit",
		canvasId: crypto.randomUUID(),
		expectedRevision: "unused",
		operations: [
			{ op: "create", ref: "a", type: "rectangle", x: 0, y: 0 },
			{ op: "create", ref: "b", type: "rectangle", x: 500, y: 0 },
			{ op: "connect", ref: "link", fromId: "a", toId: "b" },
		],
	});
	const store = createTLStore({
		shapeUtils: defaultShapeUtils,
		bindingUtils: defaultBindingUtils,
		snapshot: edit.next,
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
		const arrow = editor.getShape(
			edit.createdShapes.link as TLShape["id"],
		) as import("tldraw").TLArrowShape;
		const before = getArrowInfo(editor, arrow)!;
		expect(before.isValid).toBe(true);
		const moved = prepareCanvasEdit(store.getStoreSnapshot(), {
			action: "edit",
			canvasId: crypto.randomUUID(),
			expectedRevision: "unused",
			operations: [{ op: "update", shapeId: edit.createdShapes.b!, y: 300 }],
		});
		store.mergeRemoteChanges(() => store.put(moved.changed));
		const after = getArrowInfo(
			editor,
			editor.getShape(arrow.id) as import("tldraw").TLArrowShape,
		)!;
		expect(after.isValid).toBe(true);
		expect(after.end.point.y).toBeGreaterThan(before.end.point.y);
		expect(editor.getBindingsFromShape(arrow, "arrow")).toHaveLength(2);
		editor.updateShape({
			id: edit.createdShapes.a as TLShape["id"],
			type: "geo",
			isLocked: true,
		});
		expect(() =>
			prepareCanvasEdit(store.getStoreSnapshot(), {
				action: "edit",
				canvasId: crypto.randomUUID(),
				expectedRevision: "unused",
				operations: [
					{
						op: "update",
						shapeId: edit.createdShapes.a!,
						text: "Cannot modify",
					},
				],
			}),
		).toThrow("locked");
	} finally {
		editor.dispose();
		container.remove();
		await uninstallTestDom();
	}
});

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

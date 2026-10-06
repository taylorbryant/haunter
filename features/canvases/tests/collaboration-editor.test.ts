import { expect, test } from "bun:test";
import type { TLShape } from "tldraw";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import { canvasFingerprint, normalizeCanvasSnapshot } from "../lib/document";
import { prepareCanvasEdit } from "@/infra/canvases/shape-edits";

test("MCP edits actual grouped library templates without changing their transforms, selection or undo history", async () => {
	installTestDom();
	const {
		Editor,
		createTLStore,
		defaultShapeUtils,
		defaultBindingUtils,
		tipTapDefaultExtensions,
		defaultAddFontsFromNode,
		SelectTool,
		getArrowInfo,
	} = await import("tldraw");
	const { CANVAS_LIBRARY_ITEMS, materializeCanvasLibraryItem } = await import(
		"../lib/library"
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
		options: {
			text: {
				tipTapConfig: { extensions: tipTapDefaultExtensions },
				addFontsFromNode: defaultAddFontsFromNode,
			},
		},
		tools: [SelectTool],
		initialState: "select",
		getContainer: () => container,
	});
	try {
		const template = CANVAS_LIBRARY_ITEMS.find(
			(item) => item.id === "mobile-app-screen",
		)!;
		const materialized = materializeCanvasLibraryItem(template, {
			x: 200,
			y: 300,
		});
		editor.createShapes(materialized.shapes);
		editor.groupShapes(materialized.shapeIds, {
			groupId: materialized.groupId,
		});
		const frameId = "shape:frame" as TLShape["id"];
		editor.createShape({
			id: frameId,
			type: "frame",
			x: 100,
			y: 200,
			props: { w: 1500, h: 1500 },
		});
		editor.reparentShapes([materialized.groupId], frameId);
		editor.updateShape({ id: frameId, type: "frame", rotation: Math.PI / 6 });
		editor.updateShape({
			id: materialized.groupId,
			type: "group",
			rotation: Math.PI / 3,
		});
		editor.select(materialized.groupId);
		const label = materialized.shapeIds
			.map((id) => editor.getShape(id)!)
			.find((shape) => shape.type === "text")!;
		const boxes = materialized.shapeIds
			.map((id) => editor.getShape(id)!)
			.filter((shape) => shape.type === "geo");
		editor.markHistoryStoppingPoint("local move");
		editor.updateShape({ id: boxes[1].id, type: "geo", x: boxes[1].x + 10 });
		editor.undo();
		expect(editor.getCanRedo()).toBe(true);
		const before = normalizeCanvasSnapshot({ ...store.getStoreSnapshot() });
		const labelBefore = editor.getShapePageTransform(label).point();
		const result = prepareCanvasEdit(before, {
			action: "edit",
			canvasId: "canvas",
			expectedRevision: "unused",
			operations: [
				{
					op: "update",
					shapeId: label.id,
					x: label.x + 15,
					y: label.y + 20,
					text: "Tasks",
					color: "blue",
				},
				{ op: "update", shapeId: boxes[0].id, width: 600 },
				{
					op: "create",
					ref: "button",
					type: "rectangle",
					parentId: materialized.groupId,
					x: 700,
					y: 400,
					text: "Add task",
				},
				{ op: "connect", ref: "link", fromId: boxes[0].id, toId: "button" },
			],
		});
		store.mergeRemoteChanges(() => store.put(result.changed));
		expect(normalizeCanvasSnapshot({ ...store.getStoreSnapshot() })).toEqual(
			result.next,
		);
		expect(editor.getShape(materialized.groupId)).toEqual(
			before.store[materialized.groupId] as TLShape,
		);
		expect(editor.getShape(frameId)).toEqual(before.store[frameId] as TLShape);
		expect(editor.getSelectedShapeIds()).toEqual([materialized.groupId]);
		expect(editor.getCanRedo()).toBe(true);
		editor.redo();
		expect(editor.getShape(boxes[1].id)?.x).toBe(boxes[1].x + 10);
		expect(
			editor.getShape(result.createdShapes.button as TLShape["id"]),
		).toBeDefined();
		editor.undo();
		expect(normalizeCanvasSnapshot({ ...store.getStoreSnapshot() })).toEqual(
			result.next,
		);
		const labelAfter = editor.getShapePageTransform(label.id).point();
		expect(labelAfter.x - labelBefore.x).toBeCloseTo(-20);
		expect(labelAfter.y - labelBefore.y).toBeCloseTo(15);
		const updated = editor.getShape(label.id) as import("tldraw").TLTextShape;
		expect(updated.props.font).toBe(
			(label as import("tldraw").TLTextShape).props.font,
		);
		expect(updated.meta).toEqual(label.meta);
		const arrow = editor.getShape(
			result.createdShapes.link as TLShape["id"],
		) as import("tldraw").TLArrowShape;
		const arrowBefore = getArrowInfo(editor, arrow)!;
		expect(arrowBefore.isValid).toBe(true);
		expect(arrow.parentId).toBe(materialized.groupId);
		const moved = prepareCanvasEdit(result.next, {
			action: "edit",
			canvasId: "canvas",
			expectedRevision: "unused",
			operations: [
				{ op: "update", shapeId: result.createdShapes.button, y: 700 },
			],
		});
		store.mergeRemoteChanges(() => store.put(moved.changed));
		const arrowAfter = getArrowInfo(editor, arrow)!;
		expect(arrowAfter.isValid).toBe(true);
		expect(arrowAfter.end.point.y).not.toBe(arrowBefore.end.point.y);
		const deletion = prepareCanvasEdit(moved.next, {
			action: "delete",
			canvasId: "canvas",
			expectedRevision: "unused",
			shapeIds: [result.createdShapes.button, result.createdShapes.link],
		});
		store.mergeRemoteChanges(() => {
			store.remove(deletion.deleted);
			store.put(deletion.changed);
		});
		expect(normalizeCanvasSnapshot({ ...store.getStoreSnapshot() })).toEqual(
			deletion.next,
		);
		expect(editor.getShape(materialized.groupId)).toBeDefined();
		expect(editor.getShape(label.id)?.parentId).toBe(materialized.groupId);
	} finally {
		editor.dispose();
		container.remove();
		await uninstallTestDom();
	}
});

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

test("native structure edits publish stable bindings without changing the open editor's selection or redo", async () => {
	const { createCanvasStructureEditor } = await import(
		"@/infra/canvases/structure-editor"
	);
	const native = createCanvasStructureEditor();
	installTestDom();
	const {
		Editor,
		createTLStore,
		defaultShapeUtils,
		defaultBindingUtils,
		tipTapDefaultExtensions,
		defaultAddFontsFromNode,
		SelectTool,
		getArrowInfo,
	} = await import("tldraw");
	const container = document.createElement("div");
	document.body.append(container);
	const store = createTLStore({
		shapeUtils: defaultShapeUtils,
		bindingUtils: defaultBindingUtils,
		snapshot: normalizeCanvasSnapshot({}),
	});
	const editor = new Editor({
		store,
		shapeUtils: defaultShapeUtils,
		bindingUtils: defaultBindingUtils,
		tools: [SelectTool],
		initialState: "select",
		getContainer: () => container,
		options: {
			text: {
				tipTapConfig: { extensions: tipTapDefaultExtensions },
				addFontsFromNode: defaultAddFontsFromNode,
			},
		},
	});
	try {
		const { CANVAS_LIBRARY_ITEMS, materializeCanvasLibraryItem } = await import(
			"../lib/library"
		);
		const item = CANVAS_LIBRARY_ITEMS.find(
			(item) => item.id === "request-flow",
		)!;
		const template = materializeCanvasLibraryItem(item, { x: 200, y: 300 });
		editor.createShapes(template.shapes);
		editor.createBindings(template.bindings);
		editor.groupShapes(template.shapeIds, { groupId: template.groupId });
		const outside = "shape:outside" as TLShape["id"];
		editor.createShape({ id: outside, type: "geo", x: 1000, y: 1000 });
		editor.select(outside);
		editor.markHistoryStoppingPoint("local move");
		editor.updateShape({ id: outside, type: "geo", x: 1050 });
		editor.undo();
		expect(editor.getCanRedo()).toBe(true);
		const before = normalizeCanvasSnapshot({ ...store.getStoreSnapshot() });
		const selectedBefore = editor.getSelectedShapeIds();
		const viewport = editor.getCamera();
		const result = await native.prepare({
			snapshot: before,
			command: {
				action: "edit",
				canvasId: crypto.randomUUID(),
				expectedRevision: "test",
				operations: [
					{
						op: "create",
						ref: "frame",
						type: "frame",
						x: 0,
						y: 0,
						width: 2000,
						height: 1600,
					},
					{ op: "reparent", shapeIds: [template.groupId], parentId: "frame" },
					{ op: "update", shapeId: "frame", x: 80, y: 90 },
					{ op: "update", shapeId: template.groupId, x: 300 },
				],
			},
		});
		store.mergeRemoteChanges(() => {
			store.remove(result.deleted);
			store.put(result.changed);
		});
		expect(normalizeCanvasSnapshot({ ...store.getStoreSnapshot() })).toEqual(
			result.next,
		);
		expect(editor.getSelectedShapeIds()).toEqual(selectedBefore);
		expect(editor.getCamera()).toEqual(viewport);
		expect(editor.getCanRedo()).toBe(true);
		const arrows = editor
			.getCurrentPageShapes()
			.filter((s) => s.type === "arrow");
		expect(arrows.length).toBeGreaterThan(0);
		for (const arrow of arrows)
			expect(getArrowInfo(editor, arrow.id)?.isValid).toBe(true);
		const firstArrow = arrows[0];
		const target = editor.getBindingsFromShape(firstArrow, "arrow")[0].toId;
		const arrowBefore = getArrowInfo(editor, firstArrow.id);
		const node = editor.getShape(target)!;
		editor.updateShape({ id: node.id, type: node.type, x: node.x + 50 });
		expect(getArrowInfo(editor, firstArrow.id)).not.toEqual(arrowBefore);
	} finally {
		editor.dispose();
		container.remove();
		await uninstallTestDom();
		await native.stop();
	}
}, 30_000);

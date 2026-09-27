import { expect, test } from "bun:test";
import type { TLRecord, TLShape } from "@tldraw/tlschema";
import { prepareCanvasLibraryInsertion } from "@/infra/canvases/library-insertion";
import { prepareCanvasEdit } from "@/infra/canvases/shape-edits";
import { normalizeCanvasSnapshot } from "../lib/document";
import { CANVAS_LIBRARY_ITEMS } from "../lib/library";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";

test("all library items insert into a native editor without corrections, remain editable, and preserve local selection/history", async () => {
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
		editor.createShape({
			id: "shape:local" as TLShape["id"],
			type: "geo",
			x: -100,
			y: -100,
		});
		editor.select("shape:local" as TLShape["id"]);
		editor.markHistoryStoppingPoint("local move");
		editor.updateShape({
			id: "shape:local" as TLShape["id"],
			type: "geo",
			x: -200,
		});
		editor.undo();
		for (const item of CANVAS_LIBRARY_ITEMS) {
			for (const scale of [0.1, 0.5, 1, 2, 4]) {
				const before = normalizeCanvasSnapshot({ ...store.getStoreSnapshot() });
				const result = prepareCanvasLibraryInsertion(before, {
					action: "insert-library",
					canvasId: "unused",
					expectedRevision: "unused",
					itemId: item.id,
					itemVersion: item.version,
					x: 200,
					y: 300,
					scale,
				});
				store.mergeRemoteChanges(() => store.put(result.changed));
				expect(
					normalizeCanvasSnapshot({ ...store.getStoreSnapshot() }),
					`${item.id} at ${scale}`,
				).toEqual(result.next);
				expect(editor.getSelectedShapeIds()).toEqual([
					"shape:local" as TLShape["id"],
				]);
				expect(editor.getCanRedo()).toBe(true);
				const { rootShapeId, shapeIdsByKey } = result.insertion;
				expect(editor.getShape(rootShapeId)).toMatchObject({
					x: 200,
					y: 300,
					meta: { haunterLibraryItemId: item.id },
				});
				for (const element of item.elements) {
					const shape = editor.getShape(shapeIdsByKey[element.key])!;
					expect(shape.meta.haunterLibraryKey).toBe(element.key);
					if (shape.type === "arrow") {
						const info = getArrowInfo(editor, shape);
						expect(info?.isValid, item.id).toBe(true);
					} else {
						const point = editor.getShapePageTransform(shape).point();
						expect(point.x).toBeCloseTo(200 + element.x * scale);
						expect(point.y).toBeCloseTo(300 + element.y * scale);
					}
				}
				const label = result.changed.find(
					(r): r is TLShape => r.typeName === "shape" && r.type === "text",
				);
				if (label) {
					const edit = prepareCanvasEdit(result.next, {
						action: "edit",
						canvasId: "unused",
						expectedRevision: "unused",
						operations: [
							{ op: "update", shapeId: label.id, text: "Custom label" },
						],
					});
					store.mergeRemoteChanges(() => store.put(edit.changed));
					expect(
						normalizeCanvasSnapshot({ ...store.getStoreSnapshot() }),
					).toEqual(edit.next);
				}
				// Remove only the remote insertion to keep the fixture bounded.
				store.mergeRemoteChanges(() =>
					store.remove(result.changed.map((r) => r.id)),
				);
			}
		}
		editor.redo();
		expect(editor.getShape("shape:local" as TLShape["id"])?.x).toBe(-200);
	} finally {
		editor.dispose();
		container.remove();
		await uninstallTestDom();
	}
}, 30_000);

test("insertion rejects unknown/stale library IDs and ambiguous or nonexistent pages without modifying the snapshot", () => {
	const before = normalizeCanvasSnapshot({});
	const item = CANVAS_LIBRARY_ITEMS[0];
	const command = {
		action: "insert-library" as const,
		canvasId: "unused",
		expectedRevision: "unused",
		itemId: item.id,
		itemVersion: item.version,
		x: 0,
		y: 0,
		scale: 1,
	};
	const original = structuredClone(before);
	for (const input of [
		{ itemId: "unknown" },
		{ itemVersion: item.version + 1 },
		{ pageId: "page:missing" },
		{ pageId: "document:document" },
	]) {
		expect(() =>
			prepareCanvasLibraryInsertion(before, { ...command, ...input }),
		).toThrow();
		expect(before).toEqual(original);
	}
	const records: Record<string, TLRecord> = { ...before.store };
	records["page:other"] = {
		...records["page:page"],
		id: "page:other",
		index: "a2",
	} as TLRecord;
	const multiple = normalizeCanvasSnapshot({ ...before, store: records });
	expect(() => prepareCanvasLibraryInsertion(multiple, command)).toThrow(
		"pageId",
	);
	const result = prepareCanvasLibraryInsertion(multiple, {
		...command,
		pageId: "page:other",
	});
	expect(result.insertion.pageId).toBe("page:other");
	expect(result.changed[0]).toMatchObject({ parentId: "page:other" });
});

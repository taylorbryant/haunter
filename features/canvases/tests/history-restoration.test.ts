import { expect, test } from "bun:test";
import { InMemorySyncStorage } from "@tldraw/sync-core";
import type { TLRecord, TLAsset, TLShape } from "@tldraw/tlschema";
import { prepareCanvasHistoryRestoration } from "@/infra/canvases/history-restoration";
import { prepareCanvasEdit } from "@/infra/canvases/shape-edits";
import {
	canvasSchema,
	createCanvasRoom,
	normalizeCanvasSnapshot,
	projectCanvasRoom,
} from "../lib/document";

const documentId = "document:document" as TLRecord["id"];
const canvasId = "00000000-0000-4000-8000-000000000001";
function drawing() {
	return prepareCanvasEdit(normalizeCanvasSnapshot({}), {
		action: "edit",
		canvasId,
		expectedRevision: "test",
		operations: [
			{
				op: "create",
				ref: "box",
				type: "rectangle",
				x: 0,
				y: 0,
				text: "Original box",
			},
		],
	}).next;
}

test("history restoration preserves native locked shapes and image assets but excludes legacy session records", () => {
	const before = drawing();
	const saved = normalizeCanvasSnapshot({});
	const asset = canvasSchema.types.asset.create({
		id: "asset:original",
		type: "image",
		props: {
			name: "Original image",
			src: "data:image/png;base64,aGVsbG8=",
			w: 10,
			h: 20,
			mimeType: "image/png",
			isAnimated: false,
		},
	}) as TLAsset;
	const shape = canvasSchema.types.shape.create({
		id: "shape:original",
		type: "image",
		parentId: "page:page",
		index: "a1",
		isLocked: true,
		props: {
			w: 10,
			h: 20,
			assetId: asset.id,
			playing: true,
			url: "",
			crop: null,
			flipX: false,
			flipY: false,
			altText: "Original description",
		},
	}) as TLShape;
	saved.store[asset.id] = asset;
	saved.store[shape.id] = shape;
	const camera = canvasSchema.types.camera.create({
		id: "camera:page:page",
		x: 99,
		y: 100,
		z: 2,
	});
	saved.store[camera.id] = camera;
	const original = structuredClone(before);
	const edit = prepareCanvasHistoryRestoration(before, JSON.stringify(saved));
	expect(before).toEqual(original);
	expect(edit.next.store[shape.id]).toEqual(shape);
	expect(edit.next.store[asset.id]).toEqual(asset);
	expect(edit.next.store[camera.id]).toBeUndefined();
	const storage = new InMemorySyncStorage<TLRecord>({
		snapshot: createCanvasRoom({ ...before }),
	});
	storage.transaction((tx) => {
		for (const id of edit.deleted) tx.delete(id);
		for (const record of edit.changed) tx.set(record.id, record);
	});
	expect(projectCanvasRoom(storage.getSnapshot())).toEqual(
		normalizeCanvasSnapshot({ ...saved }),
	);
	const cleared = prepareCanvasHistoryRestoration(
		edit.next,
		JSON.stringify(normalizeCanvasSnapshot({})),
	);
	expect(cleared.deleted.toSorted()).toEqual([asset.id, shape.id].toSorted());
});

test("invalid, future-schema and oversized saved canvas versions are rejected before changing records", () => {
	const before = drawing();
	const badRecord = structuredClone(before);
	badRecord.store[documentId] = {
		...badRecord.store[documentId],
		gridSize: "invalid",
	} as unknown as TLRecord;
	const oversized = structuredClone(before);
	oversized.store[documentId]!.meta = {
		invalid: "x".repeat(5_000_001),
	};
	for (const snapshot of [
		"{",
		"null",
		"[]",
		JSON.stringify(badRecord),
		JSON.stringify(oversized),
		JSON.stringify({ ...before, schema: { schemaVersion: 9999 } }),
	]) {
		expect(() => prepareCanvasHistoryRestoration(before, snapshot)).toThrow(
			"This canvas history version cannot be restored.",
		);
	}
	expect(
		Object.values(before.store).filter((record) => record.typeName === "shape"),
	).toHaveLength(1);
});

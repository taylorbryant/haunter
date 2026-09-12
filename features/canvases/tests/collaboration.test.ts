import { expect, test } from "bun:test";
import type { TLShape } from "tldraw";
import {
	createCanvasRoom,
	projectCanvasRoom,
	normalizeCanvasSnapshot,
	canvasFingerprint,
} from "../lib/document";
export function canvasShape(id = "shape:one"): TLShape {
	return {
		id,
		typeName: "shape",
		type: "geo",
		x: 0,
		y: 0,
		rotation: 0,
		index: "a1",
		parentId: "page:page",
		isLocked: false,
		opacity: 1,
		meta: {},
		props: {
			flipX: false,
			flipY: false,
			geo: "rectangle",
			w: 100,
			h: 100,
			color: "black",
			labelColor: "black",
			fill: "none",
			dash: "draw",
			size: "m",
			font: "draw",
			align: "middle",
			verticalAlign: "middle",
			growY: 0,
			url: "",
			scale: 1,
			richText: { type: "doc", content: [{ type: "paragraph" }] },
		},
	} as TLShape;
}

test("native room conversion preserves document records and omits camera state", async () => {
	const snapshot = normalizeCanvasSnapshot({});
	snapshot.store["shape:one" as TLShape["id"]] = canvasShape();
	const room = createCanvasRoom({ ...snapshot });
	expect(projectCanvasRoom(room)).toEqual(snapshot);
	expect(await canvasFingerprint(snapshot)).toBe(
		await canvasFingerprint(projectCanvasRoom(room)),
	);
	const invalid = structuredClone(room);
	invalid.documents.push(invalid.documents[0]!);
	expect(() => projectCanvasRoom(invalid)).toThrow("Duplicate");
	const bad = structuredClone(snapshot);
	(bad.store["shape:one" as TLShape["id"]] as TLShape).x =
		"bad" as unknown as number;
	expect(() => createCanvasRoom({ ...bad })).toThrow();
});

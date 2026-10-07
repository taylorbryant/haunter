import { expect, test } from "bun:test";
import type {
	TLShape,
	TLShapeId,
	TLRecord,
	TLStoreSnapshot,
} from "@tldraw/tlschema";
import type { CanvasOperation } from "../editing";
import { normalizeCanvasSnapshot } from "../lib/document";
import { prepareCanvasEdit } from "@/infra/canvases/shape-edits";
import { createCanvasStructureEditor } from "@/infra/canvases/structure-editor";
import { createCanvasPreviewRenderer } from "@/infra/canvases/preview-renderer";
import { needsCanvasStructureEditor } from "@/infra/canvases/structure-selection";

const command = {
	action: "edit" as const,
	canvasId: crypto.randomUUID(),
	expectedRevision: "test",
};
function drawing() {
	return prepareCanvasEdit(normalizeCanvasSnapshot({}), {
		...command,
		operations: [
			{
				op: "create",
				ref: "a",
				type: "rectangle",
				x: 10,
				y: 20,
				width: 100,
				height: 50,
			},
			{
				op: "create",
				ref: "b",
				type: "rectangle",
				x: 220,
				y: 140,
				width: 60,
				height: 80,
			},
			{
				op: "create",
				ref: "c",
				type: "rectangle",
				x: 500,
				y: 300,
				width: 200,
				height: 100,
			},
		],
	});
}
function shape(snapshot: TLStoreSnapshot, id: string): TLShape {
	const record = snapshot.store[id as TLShapeId];
	if (record?.typeName !== "shape") throw new Error(`Missing shape ${id}`);
	return record;
}
function world(snapshot: TLStoreSnapshot, id: string) {
	let current = shape(snapshot, id);
	let x = current.x,
		y = current.y,
		rotation = current.rotation;
	while (snapshot.store[current.parentId]?.typeName === "shape") {
		current = shape(snapshot, current.parentId);
		const c = Math.cos(current.rotation),
			s = Math.sin(current.rotation);
		[x, y] = [current.x + c * x - s * y, current.y + s * x + c * y];
		rotation += current.rotation;
	}
	return { x, y, rotation };
}
function expectPosition(
	actual: ReturnType<typeof world>,
	expected: ReturnType<typeof world>,
) {
	expect(actual.x).toBeCloseTo(expected.x, 6);
	expect(actual.y).toBeCloseTo(expected.y, 6);
	expect(Math.cos(actual.rotation)).toBeCloseTo(Math.cos(expected.rotation), 6);
	expect(Math.sin(actual.rotation)).toBeCloseTo(Math.sin(expected.rotation), 6);
}

test("native mixed batches group, frame, move and ungroup without moving children during reparenting", async () => {
	const editor = createCanvasStructureEditor();
	const { next: source, createdShapes: ids } = drawing();
	const before = JSON.stringify(source);
	try {
		const grouped = await editor.prepare({
			snapshot: source,
			command: {
				...command,
				operations: [
					{ op: "group", ref: "component", shapeIds: [ids.a, ids.b] },
					{
						op: "create",
						ref: "frame",
						type: "frame",
						x: 1000,
						y: 500,
						width: 800,
						height: 600,
						text: "Section",
					},
					{ op: "reparent", shapeIds: ["component"], parentId: "frame" },
					{
						op: "create",
						ref: "caption",
						type: "text",
						x: 20,
						y: 30,
						parentId: "frame",
						text: "Inside frame",
					},
				],
			},
		});
		const groupId = grouped.createdShapes.component;
		const frameId = grouped.createdShapes.frame as TLShapeId;
		expect(shape(grouped.next, groupId).parentId).toBe(frameId);
		expect(shape(grouped.next, grouped.createdShapes.caption).parentId).toBe(
			frameId,
		);
		for (const id of [ids.a, ids.b])
			expectPosition(world(grouped.next, id), world(source, id));
		const moved = await editor.prepare({
			snapshot: grouped.next,
			command: {
				...command,
				operations: [
					{
						op: "update",
						shapeId: frameId,
						x: 1300,
						text: "Renamed",
						width: 900,
					},
					{
						op: "update",
						shapeId: groupId,
						x: shape(grouped.next, groupId).x + 50,
					},
					{ op: "ungroup", shapeId: groupId },
				],
			},
		});
		expect(moved.deleted).toEqual([groupId as TLRecord["id"]]);
		expect(shape(moved.next, frameId).props).toMatchObject({
			name: "Renamed",
			w: 900,
			h: 600,
		});
		for (const id of [ids.a, ids.b]) {
			expect(shape(moved.next, id).parentId).toBe(frameId);
			expectPosition(world(moved.next, id), {
				...world(source, id),
				x: world(source, id).x + 350,
			});
		}
		expect(JSON.stringify(source)).toBe(before);
	} finally {
		await editor.stop();
	}
}, 30_000);

test("group and ungroup preserve world position and rotation under rotated frames", async () => {
	const editor = createCanvasStructureEditor();
	const { next: source, createdShapes: ids } = drawing();
	try {
		const framed = await editor.prepare({
			snapshot: source,
			command: {
				...command,
				operations: [
					{ op: "create", ref: "frame", type: "frame", x: 100, y: 200 },
					{ op: "reparent", shapeIds: [ids.a, ids.b], parentId: "frame" },
				],
			},
		});
		const frame = shape(framed.next, framed.createdShapes.frame);
		frame.rotation = Math.PI / 3;
		shape(framed.next, ids.b).rotation = Math.PI / 6;
		const grouped = await editor.prepare({
			snapshot: framed.next,
			command: {
				...command,
				operations: [{ op: "group", ref: "g", shapeIds: [ids.a, ids.b] }],
			},
		});
		const group = shape(grouped.next, grouped.createdShapes.g);
		group.rotation += Math.PI / 7;
		const positions = [ids.a, ids.b].map((id) => world(grouped.next, id));
		const ungrouped = await editor.prepare({
			snapshot: grouped.next,
			command: {
				...command,
				operations: [
					{ op: "ungroup", shapeId: group.id },
					{
						op: "reparent",
						shapeIds: [ids.a, ids.b],
						parentId: frame.parentId,
					},
				],
			},
		});
		[ids.a, ids.b].forEach((id, i) =>
			expectPosition(world(ungrouped.next, id), positions[i]),
		);
	} finally {
		await editor.stop();
	}
}, 30_000);

test("native layout aligns page bounds and distributes equal gaps through rotated parents", async () => {
	const editor = createCanvasStructureEditor();
	const { next: source, createdShapes: ids } = drawing();
	try {
		const framed = await editor.prepare({
			snapshot: source,
			command: {
				...command,
				operations: [
					{ op: "create", ref: "frame", type: "frame", x: 100, y: 100 },
					{ op: "reparent", shapeIds: [ids.b], parentId: "frame" },
				],
			},
		});
		shape(framed.next, framed.createdShapes.frame).rotation = Math.PI / 2;
		shape(framed.next, ids.b).rotation = -Math.PI / 2;
		const result = await editor.prepare({
			snapshot: framed.next,
			command: {
				...command,
				operations: [
					{ op: "align", shapeIds: [ids.a, ids.b, ids.c], alignment: "top" },
					{
						op: "distribute",
						shapeIds: [ids.a, ids.b, ids.c],
						direction: "horizontal",
					},
				],
			},
		});
		const positions = [ids.a, ids.b, ids.c]
			.map((id) => ({
				...world(result.next, id),
				width: (shape(result.next, id).props as { w: number }).w,
			}))
			.sort((a, b) => a.x - b.x);
		expect(positions[0].y).toBeCloseTo(positions[1].y, 6);
		expect(positions[1].y).toBeCloseTo(positions[2].y, 6);
		expect(positions[1].x - positions[0].x - positions[0].width).toBeCloseTo(
			positions[2].x - positions[1].x - positions[1].width,
			6,
		);
	} finally {
		await editor.stop();
	}
}, 30_000);

test("layout measures wrapped text using the same bundled fonts as canvas previews", async () => {
	const editor = createCanvasStructureEditor();
	const renderer = createCanvasPreviewRenderer();
	const text = prepareCanvasEdit(normalizeCanvasSnapshot({}), {
		...command,
		operations: [
			{
				op: "create",
				ref: "short",
				type: "text",
				x: 0,
				y: 0,
				width: 200,
				text: "Short",
			},
			{
				op: "create",
				ref: "long",
				type: "text",
				x: 400,
				y: 200,
				width: 150,
				text: "A much longer piece of text that wraps across several lines",
			},
		],
	});
	try {
		const result = await editor.prepare({
			snapshot: text.next,
			command: {
				...command,
				operations: [
					{
						op: "align",
						shapeIds: Object.values(text.createdShapes),
						alignment: "bottom",
					},
				],
			},
		});
		const a = await renderer.render({
			snapshot: result.next,
			command: {
				action: "preview",
				canvasId: command.canvasId,
				shapeIds: [text.createdShapes.short],
			},
		});
		const b = await renderer.render({
			snapshot: result.next,
			command: {
				action: "preview",
				canvasId: command.canvasId,
				shapeIds: [text.createdShapes.long],
			},
		});
		expect(a.bounds.y + a.bounds.height).toBeCloseTo(
			b.bounds.y + b.bounds.height,
			4,
		);
		expect(a.bounds.height).toBeLessThan(b.bounds.height);
	} finally {
		await editor.stop();
		await renderer.stop();
	}
}, 30_000);

test("native organization rejects locks, cycles, overlapping selections, duplicate refs and implicit group dissolution", async () => {
	const editor = createCanvasStructureEditor();
	const { next: source, createdShapes: ids } = drawing();
	try {
		const grouped = await editor.prepare({
			snapshot: source,
			command: {
				...command,
				operations: [{ op: "group", ref: "g", shapeIds: [ids.a, ids.b] }],
			},
		});
		const g = grouped.createdShapes.g;
		const pageId = shape(grouped.next, g).parentId;
		const cases: [CanvasOperation[], string][] = [
			[
				[{ op: "reparent", shapeIds: [ids.a], parentId: pageId }],
				"at least two",
			],
			[[{ op: "align", shapeIds: [g, ids.a], alignment: "left" }], "not both"],
			[[{ op: "reparent", shapeIds: [g], parentId: g }], "itself"],
			[
				[
					{ op: "group", ref: "g", shapeIds: [g, ids.c] },
					{ op: "create", ref: "g", type: "frame", x: 0, y: 0 },
				],
				"Duplicate reference",
			],
			[[{ op: "align", shapeIds: [g, g], alignment: "top" }], "only once"],
			[[{ op: "update", shapeId: g, width: 400 }], "x/y movement only"],
		];
		for (const [operations, message] of cases) {
			const error = await editor
				.prepare({
					snapshot: grouped.next,
					command: { ...command, operations },
				})
				.then(
					() => null,
					(error) => error,
				);
			expect(error).toMatchObject({
				code: "INVALID_CANVAS_EDIT",
				message: expect.stringContaining(message),
			});
		}
		shape(grouped.next, ids.a).isLocked = true;
		for (const operations of [
			[{ op: "update", shapeId: g, x: 40 }],
			[{ op: "ungroup", shapeId: g }],
			[{ op: "align", shapeIds: [g, ids.c], alignment: "left" }],
		] as CanvasOperation[][]) {
			const error = await editor
				.prepare({
					snapshot: grouped.next,
					command: { ...command, operations },
				})
				.then(
					() => null,
					(error) => error,
				);
			expect(error).toMatchObject({
				code: "INVALID_CANVAS_EDIT",
				message: expect.stringContaining("locked"),
			});
		}
	} finally {
		await editor.stop();
	}
}, 60_000);

test("simple leaf batches keep their browser-free path; unavailable native editor cannot change a snapshot", async () => {
	const { next: source, createdShapes: ids } = drawing();
	expect(
		needsCanvasStructureEditor(source, {
			...command,
			operations: [{ op: "update", shapeId: ids.a, text: "Updated" }],
		}),
	).toBe(false);
	expect(
		needsCanvasStructureEditor(source, {
			...command,
			operations: [{ op: "group", ref: "g", shapeIds: [ids.a, ids.b] }],
		}),
	).toBe(true);
	const editor = createCanvasStructureEditor();
	await editor.stop();
	const before = JSON.stringify(source);
	await expect(
		editor.prepare({
			snapshot: source,
			command: {
				...command,
				operations: [{ op: "group", ref: "g", shapeIds: [ids.a, ids.b] }],
			},
		}),
	).rejects.toMatchObject({ code: "CANVAS_WORKER_UNAVAILABLE" });
	expect(JSON.stringify(source)).toBe(before);
});

test("organization cannot cross pages, bypass ancestor or arrow locks, or implicitly dissolve an enclosing group", async () => {
	const editor = createCanvasStructureEditor();
	const { next: source, createdShapes: ids } = drawing();
	const linked = prepareCanvasEdit(source, {
		...command,
		operations: [{ op: "connect", ref: "arrow", fromId: ids.a, toId: ids.c }],
	});
	try {
		const grouped = await editor.prepare({
			snapshot: linked.next,
			command: {
				...command,
				operations: [{ op: "group", ref: "g", shapeIds: [ids.a, ids.b] }],
			},
		});
		const g = grouped.createdShapes.g;
		const pageId = shape(grouped.next, g).parentId;
		const secondPage = "page:second" as typeof pageId;
		const basePage = grouped.next.store[pageId];
		if (basePage.typeName !== "page") throw new Error("Expected page");
		grouped.next.store[secondPage] = {
			...basePage,
			id: secondPage as typeof basePage.id,
			name: "Second",
		};
		const reject = async (
			snapshot: TLStoreSnapshot,
			operations: CanvasOperation[],
			message: string,
		) => {
			const before = JSON.stringify(snapshot);
			const error = await editor
				.prepare({ snapshot, command: { ...command, operations } })
				.then(
					() => null,
					(error) => error,
				);
			expect(error).toMatchObject({
				code: "INVALID_CANVAS_EDIT",
				message: expect.stringContaining(message),
			});
			expect(JSON.stringify(snapshot)).toBe(before);
		};
		await reject(
			grouped.next,
			[{ op: "reparent", shapeIds: [g], parentId: secondPage }],
			"same canvas page",
		);
		await reject(
			grouped.next,
			[{ op: "group", ref: "subgroup", shapeIds: [ids.a, ids.b] }],
			"at least two",
		);
		await reject(
			grouped.next,
			[{ op: "group", ref: "g2", shapeIds: [ids.a, ids.c] }],
			"same immediate parent",
		);
		await reject(
			grouped.next,
			[{ op: "create", ref: "frame", type: "frame", x: 0, y: 0 }],
			"Specify pageId",
		);
		await reject(
			grouped.next,
			[{ op: "reparent", shapeIds: [linked.createdShapes.arrow], parentId: g }],
			"bound arrows",
		);
		shape(grouped.next, g).isLocked = true;
		await reject(
			grouped.next,
			[{ op: "align", shapeIds: [ids.a, ids.c], alignment: "left" }],
			"locked",
		);
		shape(grouped.next, g).isLocked = false;
		shape(grouped.next, linked.createdShapes.arrow).isLocked = true;
		// Moving a group changes the connected arrow's endpoint even when its record
		// coordinates don't change. Its lock must protect that geometry too.
		await reject(grouped.next, [{ op: "update", shapeId: g, x: 80 }], "locked");
	} finally {
		await editor.stop();
	}
}, 30_000);

import { expect, test } from "bun:test";
import type {
	TLPage,
	TLRecord,
	TLShape,
	TLStoreSnapshot,
} from "@tldraw/tlschema";
import { prepareCanvasEdit } from "@/infra/canvases/shape-edits";
import { normalizeCanvasSnapshot } from "../lib/document";
import { CanvasOperationSchema, type CanvasOperation } from "../editing";

const readable = (snapshot: TLStoreSnapshot) => ({
	...snapshot,
	store: snapshot.store as Record<string, TLRecord>,
});

function fixture() {
	const initial = prepareCanvasEdit(normalizeCanvasSnapshot({}), {
		action: "edit",
		canvasId: "canvas",
		expectedRevision: "unused",
		operations: ["a", "b", "c", "outside"].map((ref, index) => ({
			op: "create",
			ref,
			type: "rectangle",
			x: index * 300,
			y: 20,
			text: ref,
		})),
	});
	const ids = initial.createdShapes;
	const store = initial.next.store as Record<string, TLRecord>;
	const model = store[ids.a] as TLShape;
	const group = "shape:group" as TLShape["id"],
		frame = "shape:frame" as TLShape["id"];
	store[group] = {
		...model,
		id: group,
		type: "group",
		props: {},
		x: 100,
		y: 200,
		rotation: Math.PI / 2,
		parentId: frame,
		index: "a1" as TLShape["index"],
		meta: { libraryItem: "example" },
	};
	store[frame] = {
		...model,
		id: frame,
		type: "frame",
		props: { w: 1200, h: 1200, name: "Screen", color: "black" },
		x: 1000,
		y: 2000,
		rotation: Math.PI / 6,
		index: "a5" as TLShape["index"],
	};
	for (const key of ["a", "b", "c"]) {
		const shape = store[ids[key]] as TLShape;
		store[shape.id] = { ...shape, parentId: group };
	}
	return {
		snapshot: readable(normalizeCanvasSnapshot({ ...initial.next })),
		ids,
		group,
		frame,
	};
}
function edit(snapshot: TLStoreSnapshot, operations: CanvasOperation[]) {
	const result = prepareCanvasEdit(snapshot, {
		action: "edit",
		canvasId: "canvas",
		expectedRevision: "unused",
		operations,
	});
	return { ...result, next: readable(result.next) };
}
function remove(snapshot: TLStoreSnapshot, shapeIds: string[]) {
	const result = prepareCanvasEdit(snapshot, {
		action: "delete",
		canvasId: "canvas",
		expectedRevision: "unused",
		shapeIds,
	});
	return {
		...result,
		next: readable(result.next),
		deleted: result.deleted.map(String),
	};
}

test("nested leaf edits use parent coordinates and preserve ancestor transforms and unrelated records", () => {
	const { snapshot, ids, group, frame } = fixture();
	const original = structuredClone(snapshot);
	const result = edit(snapshot, [
		{
			op: "update",
			shapeId: ids.a,
			x: 25,
			y: 40,
			width: 350,
			height: 150,
			text: "New title",
			color: "blue",
		},
	]);
	expect(result.changed).toHaveLength(1);
	expect(result.next.store[ids.a]).toMatchObject({
		parentId: group,
		x: 25,
		y: 40,
		props: {
			w: 350,
			h: 150,
			color: "blue",
			richText: { content: [{ content: [{ text: "New title" }] }] },
		},
	});
	for (const id of [ids.b, ids.c, ids.outside, group, frame])
		expect(result.next.store[id]).toEqual(snapshot.store[id]);
	expect(snapshot).toEqual(original);
});

test("create accepts an existing group/frame and checks any explicit page against its ancestors", () => {
	const { snapshot, group, frame } = fixture();
	for (const parentId of [group, frame]) {
		const op = CanvasOperationSchema.parse({
			op: "create",
			ref: "label",
			type: "text",
			x: 30,
			y: 50,
			text: "Submit",
			parentId,
			pageId: "page:page",
		});
		const result = edit(snapshot, [op]);
		expect(result.next.store[result.createdShapes.label]).toMatchObject({
			type: "text",
			parentId,
			x: 30,
			y: 50,
		});
	}
	const op: CanvasOperation = {
		op: "create",
		ref: "note",
		type: "note",
		x: 0,
		y: 0,
		parentId: group,
	};
	expect(edit(snapshot, [op]).next.store).toHaveProperty(group);
	expect(() => edit(snapshot, [{ ...op, pageId: "page:other" }])).toThrow(
		"specified canvas page",
	);
	expect(() => edit(snapshot, [{ ...op, parentId: "shape:missing" }])).toThrow(
		"parent",
	);
	const multiplePages = structuredClone(snapshot);
	multiplePages.store["page:other"] = {
		id: "page:other" as TLPage["id"],
		typeName: "page",
		name: "Other",
		index: "a2" as TLPage["index"],
		meta: {},
	};
	expect(edit(multiplePages, [op]).next.store).toHaveProperty(group);
	expect(() =>
		edit(multiplePages, [
			{ op: "create", ref: "ambiguous", type: "text", x: 0, y: 0 },
		]),
	).toThrow("Specify pageId");
});

test("connections can join existing and newly created siblings inside a group", () => {
	const { snapshot, ids, group } = fixture();
	const result = edit(snapshot, [
		{
			op: "create",
			ref: "new",
			type: "rectangle",
			parentId: group,
			x: 900,
			y: 20,
		},
		{ op: "connect", ref: "link", fromId: ids.a, toId: "new", text: "Next" },
	]);
	expect(result.next.store[result.createdShapes.link]).toMatchObject({
		type: "arrow",
		parentId: group,
	});
	const bindings = result.changed.filter(
		(record) => record.typeName === "binding",
	);
	expect(bindings).toHaveLength(2);
	expect(bindings.map((binding) => String(binding.toId)).sort()).toEqual(
		[ids.a, result.createdShapes.new].sort(),
	);
	expect(() =>
		edit(snapshot, [
			{ op: "connect", ref: "cross", fromId: ids.a, toId: ids.outside },
		]),
	).toThrow("same immediate parent");
});

test("every nested write honors locks on the target, group and frame and fails atomically", () => {
	const { snapshot, ids, group, frame } = fixture();
	for (const id of [ids.a, group, frame]) {
		const locked = structuredClone(snapshot);
		locked.store[id] = { ...(locked.store[id] as TLShape), isLocked: true };
		const original = structuredClone(locked);
		expect(() =>
			edit(locked, [
				{ op: "update", shapeId: ids.outside, text: "Must roll back" },
				{ op: "update", shapeId: ids.a, text: "Blocked" },
			]),
		).toThrow("locked");
		expect(() =>
			edit(locked, [
				{ op: "connect", ref: "link", fromId: ids.a, toId: ids.b },
			]),
		).toThrow("locked");
		expect(() => remove(locked, [ids.a])).toThrow("locked");
		if (id !== ids.a)
			expect(() =>
				edit(locked, [
					{
						op: "create",
						ref: "child",
						type: "text",
						x: 0,
						y: 0,
						parentId: group,
					},
				]),
			).toThrow("locked");
		expect(locked).toEqual(original);
	}
});

test("missing, cyclic and unsupported parent chains are rejected before writing", () => {
	const { snapshot, ids, group, frame } = fixture();
	for (const parentId of ["shape:missing", ids.a, group, ids.outside]) {
		const broken = structuredClone(snapshot);
		broken.store[frame] = {
			...(broken.store[frame] as TLShape),
			parentId: parentId as TLShape["parentId"],
		};
		const original = structuredClone(broken);
		expect(() =>
			edit(broken, [{ op: "update", shapeId: ids.a, text: "Blocked" }]),
		).toThrow();
		expect(() =>
			edit(broken, [
				{
					op: "create",
					ref: "child",
					type: "text",
					parentId: group,
					x: 0,
					y: 0,
				},
			]),
		).toThrow();
		expect(broken).toEqual(original);
	}
	expect(() =>
		edit(snapshot, [{ op: "update", shapeId: group, x: 50 }]),
	).toThrow("not supported");
});

test("deletions keep groups intact and reject batches that would dissolve them", () => {
	const { snapshot, ids, group } = fixture();
	const result = remove(snapshot, [ids.a]);
	expect(result.deleted).toEqual([ids.a]);
	expect(result.next.store[group]).toEqual(snapshot.store[group]);
	expect(result.next.store[ids.b]).toEqual(snapshot.store[ids.b]);
	for (const shapeIds of [
		[ids.a, ids.b],
		[ids.a, ids.b, ids.c],
	]) {
		expect(() => remove(snapshot, shapeIds)).toThrow("at least two children");
	}
	expect(() => remove(result.next, [ids.b])).toThrow("at least two children");
	expect(() => remove(snapshot, [group])).toThrow("not supported");
});

test("nested deletion still requires connected arrows and removes their bindings together", () => {
	const { snapshot, ids, group } = fixture();
	const connected = edit(snapshot, [
		{ op: "connect", ref: "link", fromId: ids.a, toId: ids.b },
	]);
	expect(() => remove(connected.next, [ids.a])).toThrow("connected shape");
	const result = remove(connected.next, [ids.a, connected.createdShapes.link]);
	expect(
		Object.values(result.next.store).filter(
			(record) => record.typeName === "binding",
		),
	).toEqual([]);
	expect(result.next.store[group]).toEqual(snapshot.store[group]);
	expect(result.next.store[ids.b]).toBeDefined();
	expect(result.next.store[ids.c]).toBeDefined();
});

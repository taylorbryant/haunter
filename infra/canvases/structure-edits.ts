import type {
	Editor,
	TLShape,
	TLShapeId,
	TLParentId,
	TLRecord,
	TLStoreSnapshot,
} from "tldraw";
import type { CanvasCommand } from "@/features/canvases/editing";
import type { PreparedCanvasEdit } from "@/features/canvases/ports";
import { normalizeCanvasSnapshot } from "@/features/canvases/lib/document";
import { appError } from "@/features/shared/errors";
import { prepareCanvasEdit } from "./shape-edits";

const invalid = (message: string): never => {
	throw appError("InvalidCanvasEdit", { message });
};
const same = (a: unknown, b: unknown): boolean =>
	JSON.stringify(a) === JSON.stringify(b);
// Editor construction creates a local anonymous user. Keep persisted users, but
// never write that headless session identity into a collaborative document.
const snapshotOf = (editor: Editor, source: TLStoreSnapshot) => {
	const snapshot = normalizeCanvasSnapshot({
		...editor.store.getStoreSnapshot(),
	});
	for (const record of Object.values(snapshot.store)) {
		if (record.typeName === "user" && !source.store[record.id])
			delete snapshot.store[record.id];
	}
	return snapshot;
};
const movable = new Set([
	"geo",
	"text",
	"note",
	"arrow",
	"draw",
	"line",
	"highlight",
	"group",
	"frame",
]);

/** Runs only against a detached editor. Nothing reaches a live room until the whole batch succeeds. */
export async function prepareCanvasStructureEdit(
	editor: Editor,
	source: TLStoreSnapshot,
	command: Extract<CanvasCommand, { action: "edit" }>,
): Promise<PreparedCanvasEdit> {
	const initial = snapshotOf(editor, source);
	// Loading must not silently repair unrelated records as part of an agent edit.
	if (
		Object.keys(initial.store).length !== Object.keys(source.store).length ||
		Object.entries(source.store).some(
			([id, record]) => !same(record, initial.store[id as TLRecord["id"]]),
		)
	)
		invalid(
			"This canvas needs to be opened in the editor before it can be organized.",
		);
	if (
		Object.values(source.store).filter((r) => r.typeName === "shape").length >
		1000
	)
		invalid("Canvas organization supports at most 1,000 shapes per canvas.");
	const refs: Record<string, string> = Object.create(null);
	const allowedRemovals = new Set<string>();
	const resolve = (id: string) => refs[id] ?? id;
	const shape = (id: string): TLShape =>
		editor.getShape(resolve(id) as TLShapeId) ??
		invalid(`Shape ${id} does not exist.`);
	const children = (s: TLShape) =>
		editor.getSortedChildIdsForParent(s.id).map((id) => shape(id));
	function page(s: TLShape): string {
		const seen = new Set<string>();
		let current = s;
		while (true) {
			if (seen.has(current.id) || seen.size >= 128)
				invalid("The shape has a cyclic or overly deep parent hierarchy.");
			seen.add(current.id);
			if (current.isLocked) invalid(`Shape ${s.id} or an ancestor is locked.`);
			const parent = editor.store.get(current.parentId);
			if (parent?.typeName === "page") return parent.id;
			if (
				!parent ||
				parent.typeName !== "shape" ||
				!["group", "frame"].includes(parent.type)
			)
				return invalid("Shapes must belong to a canvas page, group or frame.");
			current = parent;
		}
	}
	function writable(s: TLShape) {
		page(s);
		const pending = [s];
		const seen = new Set<string>();
		while (pending.length) {
			const current = pending.pop()!;
			if (seen.has(current.id))
				invalid("The shape hierarchy contains a cycle.");
			seen.add(current.id);
			if (current.isLocked) invalid(`Shape ${current.id} is locked.`);
			if (!movable.has(current.type))
				invalid(`Organizing ${current.type} shapes is not supported.`);
			pending.push(...children(current));
		}
	}
	function connectedLocks(shapes: TLShape[]) {
		const pending = [...shapes];
		const seen = new Set<string>();
		while (pending.length) {
			const current = pending.pop()!;
			if (seen.has(current.id)) continue;
			seen.add(current.id);
			// Bound endpoints are derived geometry: an arrow can move without a record
			// diff. Check its lock (including ancestors) before translating its targets.
			for (const binding of editor.getBindingsToShape(current, "arrow"))
				page(shape(binding.fromId));
			pending.push(...children(current));
		}
	}
	function parent(id: string): TLParentId {
		const resolved = resolve(id) as TLParentId;
		const record = editor.store.get(resolved);
		if (record?.typeName === "page") return record.id;
		if (
			!record ||
			record.typeName !== "shape" ||
			!["group", "frame"].includes(record.type)
		)
			return invalid("The parent must be a canvas page, group or frame.");
		page(record);
		return record.id;
	}
	function targets(ids: string[]) {
		const shapes = ids.map(shape);
		if (new Set(shapes.map((s) => s.id)).size !== shapes.length)
			invalid("Select each shape only once.");
		const pageIds = shapes.map((s) => {
			writable(s);
			return page(s);
		});
		if (new Set(pageIds).size !== 1)
			invalid("Select shapes on the same canvas page.");
		const selected = new Set(shapes.map((s) => s.id));
		for (const s of shapes) {
			let p = editor.getShape(s.parentId);
			while (p) {
				if (selected.has(p.id))
					invalid("Select a container or its children, not both.");
				p = editor.getShape(p.parentId);
			}
		}
		editor.setCurrentPage(pageIds[0] as ReturnType<Editor["getCurrentPageId"]>);
		return shapes;
	}
	function leaving(
		shapes: TLShape[],
		destination: string,
		replacementCount = 0,
	) {
		const departing = new Map<string, number>();
		for (const s of shapes)
			if (s.parentId !== destination)
				departing.set(s.parentId, (departing.get(s.parentId) ?? 0) + 1);
		for (const [id, count] of departing) {
			const p = editor.getShape(id as TLShapeId);
			if (
				p?.type === "group" &&
				children(p).length - count + replacementCount < 2
			)
				invalid(
					`Group ${id} must retain at least two children. Ungroup it first.`,
				);
		}
	}
	async function fonts() {
		await editor.fonts.loadRequiredFontsForCurrentPage();
		await document.fonts.ready;
		if ([...document.fonts].some((f) => f.status === "error"))
			throw new Error("Canvas fonts could not be loaded.");
	}
	function newId(ref: string): TLShapeId {
		if (Object.hasOwn(refs, ref)) invalid(`Duplicate reference: ${ref}.`);
		const id = `shape:${crypto.randomUUID()}` as TLShapeId;
		refs[ref] = id;
		return id;
	}
	for (const op of command.operations) {
		const before = snapshotOf(editor, source);
		if ("ref" in op && Object.hasOwn(refs, op.ref))
			invalid(`Duplicate reference: ${op.ref}.`);
		if (op.op === "group") {
			const selected = targets(op.shapeIds);
			if (new Set(selected.map((s) => s.parentId)).size !== 1)
				invalid("Grouping requires shapes with the same immediate parent.");
			const id = newId(op.ref);
			leaving(selected, id, 1);
			await fonts();
			editor.groupShapes(selected, { groupId: id });
			if (!editor.getShape(id)) invalid("These shapes could not be grouped.");
		} else if (op.op === "ungroup") {
			const [s] = targets([op.shapeId]);
			if (s.type !== "group") invalid("Only groups can be ungrouped.");
			allowedRemovals.add(s.id);
			editor.ungroupShapes([s]);
		} else if (op.op === "reparent") {
			const selected = targets(op.shapeIds);
			const destination = parent(op.parentId);
			const p = editor.getShape(destination);
			if (p) {
				if (page(p) !== page(selected[0]))
					invalid("Reparenting must stay on the same canvas page.");
				let ancestor: TLShape | undefined = p;
				while (ancestor) {
					if (selected.some((s) => s.id === ancestor!.id))
						invalid("A shape cannot contain itself or an ancestor.");
					ancestor = editor.getShape(ancestor.parentId);
				}
			} else if (destination !== page(selected[0]))
				invalid("Reparenting must stay on the same canvas page.");
			// A bound arrow's parent is managed by tldraw; move its connected shapes instead.
			if (
				selected.some(
					(s) =>
						s.type === "arrow" &&
						editor.getBindingsFromShape(s, "arrow").length,
				)
			)
				invalid("Reparent connected nodes rather than their bound arrows.");
			leaving(selected, destination);
			editor.reparentShapes(selected, destination);
		} else if (op.op === "align" || op.op === "distribute") {
			const selected = targets(op.shapeIds);
			if (selected.some((s) => s.type === "arrow"))
				invalid(
					"Align or distribute connected nodes rather than individual arrows.",
				);
			connectedLocks(selected);
			await fonts();
			if (op.op === "align") editor.alignShapes(selected, op.alignment);
			else editor.distributeShapes(selected, op.direction);
		} else if (op.op === "create" && op.type === "frame") {
			const pages = editor.getPages();
			const destination = parent(
				op.parentId ??
					op.pageId ??
					(pages.length === 1
						? pages[0].id
						: invalid(
								"Specify pageId when the canvas contains multiple pages.",
							)),
			);
			const p = editor.getShape(destination);
			const pageId = p ? page(p) : destination;
			if (op.pageId && op.pageId !== pageId)
				invalid("The parent does not belong to the specified canvas page.");
			editor.setCurrentPage(pageId as ReturnType<Editor["getCurrentPageId"]>);
			editor.createShape({
				id: newId(op.ref),
				type: "frame",
				parentId: destination,
				x: op.x,
				y: op.y,
				props: {
					w: op.width ?? 800,
					h: op.height ?? 600,
					name: op.text ?? "",
					color: op.color ?? "black",
				},
			});
		} else if (
			op.op === "update" &&
			["group", "frame"].includes(shape(op.shapeId).type)
		) {
			const [s] = targets([op.shapeId]);
			if (
				s.type === "group" &&
				[op.width, op.height, op.text, op.color].some((v) => v !== undefined)
			)
				invalid(
					"Groups support x/y movement only; edit their children for sizing and styling.",
				);
			if ([op.x, op.y, op.width, op.height].some((v) => v !== undefined))
				connectedLocks([s]);
			editor.updateShape({
				id: s.id,
				type: s.type,
				...(op.x !== undefined ? { x: op.x } : {}),
				...(op.y !== undefined ? { y: op.y } : {}),
				props: {
					...(op.width !== undefined ? { w: op.width } : {}),
					...(op.height !== undefined ? { h: op.height } : {}),
					...(op.text !== undefined ? { name: op.text } : {}),
					...(op.color !== undefined ? { color: op.color } : {}),
				},
			});
		} else {
			// Keep the established creation / leaf-edit / connection semantics in mixed batches.
			const resolved =
				op.op === "create"
					? { ...op, parentId: op.parentId ? resolve(op.parentId) : undefined }
					: op.op === "update"
						? { ...op, shapeId: resolve(op.shapeId) }
						: { ...op, fromId: resolve(op.fromId), toId: resolve(op.toId) };
			const edit = prepareCanvasEdit(before, {
				...command,
				operations: [resolved],
			});
			editor.store.mergeRemoteChanges(() => editor.store.put(edit.changed));
			Object.assign(refs, edit.createdShapes);
		}
		// Native bindings can move an arrow or dissolve a source group. Never let these
		// side effects bypass locks or implicitly remove content from the document.
		const after = snapshotOf(editor, source);
		for (const [id, record] of Object.entries(before.store)) {
			if (!after.store[id as TLRecord["id"]] && !allowedRemovals.has(id))
				invalid(
					"This operation would implicitly remove another shape or binding. Ungroup source groups first.",
				);
			if (
				!same(record, after.store[id as TLRecord["id"]]) &&
				record.typeName === "shape"
			) {
				let current: TLRecord | undefined = record;
				const seen = new Set<string>();
				while (current?.typeName === "shape" && !seen.has(current.id)) {
					seen.add(current.id);
					if (current.isLocked)
						invalid(`Shape ${record.id} or an ancestor is locked.`);
					current = before.store[current.parentId];
				}
			}
		}
	}
	const next = snapshotOf(editor, source);
	if (
		Object.values(next.store).filter((r) => r.typeName === "shape").length >
		1000
	)
		invalid("Canvas organization supports at most 1,000 shapes per canvas.");
	return {
		next,
		createdShapes: refs,
		changed: Object.values(next.store).filter(
			(r) => !same(r, source.store[r.id]),
		),
		deleted: Object.keys(source.store).filter(
			(id) => !next.store[id as TLRecord["id"]],
		) as TLRecord["id"][],
	};
}

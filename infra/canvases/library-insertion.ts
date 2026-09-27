import {
	createBindingId,
	type TLRecord,
	type TLShape,
	type TLStoreSnapshot,
} from "@tldraw/tlschema";
import { getIndexAbove, getIndexBetween, type IndexKey } from "@tldraw/utils";
import type { CanvasCommand } from "@/features/canvases/editing";
import { normalizeCanvasSnapshot } from "@/features/canvases/lib/document";
import {
	CANVAS_LIBRARY_ITEMS,
	materializeCanvasLibraryItem,
} from "@/features/canvases/lib/library";
import { appError } from "@/features/shared/errors";

const invalid = (message: string): never => {
	throw appError("InvalidCanvasEdit", { message });
};

/** Materialize the trusted catalog only; arbitrary client records are never accepted. */
export function prepareCanvasLibraryInsertion(
	snapshot: TLStoreSnapshot,
	command: Extract<CanvasCommand, { action: "insert-library" }>,
) {
	const item = CANVAS_LIBRARY_ITEMS.find((item) => item.id === command.itemId);
	if (!item)
		return invalid("Unknown canvas library item. Search the library again.");
	if (item.version !== command.itemVersion)
		return invalid(
			"Canvas library item version mismatch. Search the library again; if it persists, update the collaboration worker.",
		);
	const records: Record<string, TLRecord> = { ...snapshot.store };
	const pages = Object.values(records).filter(
		(record) => record.typeName === "page",
	);
	const pageId =
		command.pageId ?? (pages.length === 1 ? pages[0].id : undefined);
	if (!pageId || records[pageId]?.typeName !== "page")
		return invalid(
			"Specify an existing pageId from read_canvas for a multi-page canvas.",
		);
	const materialized = materializeCanvasLibraryItem(item, {
		x: 0,
		y: 0,
		scale: command.scale,
	});
	const groupId = materialized.shapes.length > 1 ? materialized.groupId : null;
	const rootShapeId = groupId ?? materialized.shapeIds[0];
	const highestIndex = Object.values(records)
		.filter(
			(r): r is TLShape => r.typeName === "shape" && r.parentId === pageId,
		)
		.map((r) => r.index)
		.sort()
		.at(-1);
	const rootIndex = getIndexAbove(highestIndex);
	let childIndex: IndexKey | undefined;
	const changed: TLRecord[] = [];
	const base = {
		typeName: "shape",
		rotation: 0,
		isLocked: false,
		opacity: 1,
	} as const;
	if (groupId)
		changed.push({
			...base,
			id: groupId,
			type: "group",
			parentId: pageId,
			index: rootIndex,
			x: command.x,
			y: command.y,
			props: {},
			meta: materialized.rootMeta,
		} as TLShape);
	for (const shape of materialized.shapes) {
		childIndex = getIndexAbove(childIndex);
		changed.push({
			...base,
			...shape,
			parentId: groupId ?? pageId,
			index: groupId ? childIndex : rootIndex,
			x: (shape.x ?? 0) + (groupId ? 0 : command.x),
			y: (shape.y ?? 0) + (groupId ? 0 : command.y),
		} as TLShape);
	}
	// tldraw's ArrowBindingUtil places bound arrows above their highest target,
	// but below the next non-arrow sibling. Start in that stable order so opening
	// an editor or rendering a preview doesn't produce a second document edit.
	const shapes = changed.filter((r): r is TLShape => r.typeName === "shape");
	for (const arrow of shapes.filter((shape) => shape.type === "arrow")) {
		const targetIds = materialized.bindings
			.filter((binding) => binding.fromId === arrow.id)
			.map((binding) => binding.toId);
		const targets = shapes
			.filter((shape) => targetIds.includes(shape.id))
			.sort((a, b) => (a.index < b.index ? -1 : 1));
		const highest = targets.at(-1)!;
		const higher = shapes
			.filter(
				(shape) =>
					shape.parentId === arrow.parentId && shape.index > highest.index,
			)
			.sort((a, b) => (a.index < b.index ? -1 : 1));
		const nextNonArrow = higher.find((shape) => shape.type !== "arrow");
		if (
			arrow.index > highest.index &&
			(!nextNonArrow || arrow.index < nextNonArrow.index)
		)
			continue;
		arrow.index = higher.length
			? getIndexBetween(highest.index, higher[0].index)
			: getIndexAbove(highest.index);
	}
	for (const binding of materialized.bindings)
		changed.push({
			...binding,
			id: createBindingId(),
			typeName: "binding",
			meta: {},
		} as TLRecord);
	for (const record of changed) {
		if (records[record.id])
			return invalid(
				"Canvas library insertion generated a duplicate ID. Retry the operation.",
			);
		records[record.id] = record;
	}
	let next: TLStoreSnapshot;
	try {
		next = normalizeCanvasSnapshot({ ...snapshot, store: records });
	} catch {
		return invalid(
			"The resulting drawing exceeds canvas limits or contains unsupported records.",
		);
	}
	return {
		next,
		changed,
		deleted: [] as TLRecord["id"][],
		insertion: {
			itemId: item.id,
			itemVersion: item.version,
			pageId,
			rootShapeId,
			groupId,
			shapeIdsByKey: materialized.shapeIdsByKey,
		},
	};
}

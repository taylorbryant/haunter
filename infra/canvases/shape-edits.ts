import { getIndexAbove, type IndexKey } from "@tldraw/utils";
import type { TLRecord, TLShape, TLStoreSnapshot } from "@tldraw/tlschema";
import type { CanvasCommand } from "@/features/canvases/editing";
import {
	canvasSchema,
	normalizeCanvasSnapshot,
} from "@/features/canvases/lib/document";
import { appError } from "@/features/shared/errors";

const invalid = (message: string): never => {
	throw appError("InvalidCanvasEdit", { message });
};
const richText = (text: string) => ({
	type: "doc",
	content: text.split("\n").map((line) => ({
		type: "paragraph",
		...(line ? { content: [{ type: "text", text: line }] } : {}),
	})),
});
export function canvasText(value: unknown): string {
	if (!value || typeof value !== "object") return "";
	const node = value as { text?: unknown; type?: unknown; content?: unknown[] };
	if (typeof node.text === "string") return node.text;
	if (node.type === "hardBreak") return "\n";
	return (node.content ?? [])
		.map(canvasText)
		.join(node.type === "doc" ? "\n" : "");
}

/** A deliberately bounded native-shape adapter. No browser, arbitrary records or code execution. */
export function prepareCanvasEdit(
	snapshot: TLStoreSnapshot,
	command: Extract<CanvasCommand, { action: "edit" | "delete" }>,
) {
	const records: Record<string, TLRecord> = { ...snapshot.store };
	const createdShapes: Record<string, string> = {};
	const changed = new Map<string, TLRecord>();
	const deleted = new Set<string>();
	const touchedGroups = new Set<string>();
	// Walk to an actual page before accepting a target. In particular, a child
	// of a locked group must not bypass the lock through its own shape ID.
	function ancestorPage(record: TLShape): string {
		const seen = new Set<string>();
		let current = record;
		while (true) {
			if (seen.has(current.id) || seen.size >= 128)
				return invalid(
					"The shape has a cyclic or overly deep parent hierarchy.",
				);
			seen.add(current.id);
			if (current.isLocked)
				return invalid(`Shape ${record.id} or an ancestor is locked.`);
			if (current.type === "group") touchedGroups.add(current.id);
			const parent = records[current.parentId];
			if (parent?.typeName === "page") return parent.id;
			if (!parent || parent.typeName !== "shape")
				return invalid(`Shape ${record.id} has a missing parent.`);
			if (parent.type !== "group" && parent.type !== "frame")
				return invalid("Only groups and frames can contain editable shapes.");
			current = parent;
		}
	}
	function writableParent(id: string) {
		const record = records[id];
		if (record?.typeName === "page") return record.id;
		if (
			!record ||
			record.typeName !== "shape" ||
			(record.type !== "group" && record.type !== "frame")
		)
			return invalid(
				"The parent must be an existing canvas page, group or frame.",
			);
		return ancestorPage(record);
	}
	function put(candidate: unknown) {
		const record = candidate as TLRecord;
		try {
			canvasSchema.types[record.typeName].validate(record);
		} catch {
			invalid("The edit produced an invalid canvas record.");
		}
		records[record.id] = record;
		changed.set(record.id, record);
	}
	function shape(id: string): TLShape {
		const record = records[createdShapes[id] ?? id];
		if (!record || record.typeName !== "shape")
			return invalid(`Shape ${id} does not exist.`);
		if (!["geo", "text", "note", "arrow"].includes(record.type))
			return invalid(`Editing ${record.type} shapes is not supported.`);
		ancestorPage(record);
		if (
			Object.values(records).some(
				(child) => child.typeName === "shape" && child.parentId === record.id,
			)
		)
			return invalid("Only leaf shapes can be edited through this tool.");
		return record;
	}
	function base(
		ref: string,
		type: string,
		parentId: string,
		x: number,
		y: number,
	) {
		if (Object.hasOwn(createdShapes, ref))
			invalid(`Duplicate reference: ${ref}.`);
		writableParent(parentId);
		const indices = Object.values(records)
			.filter((r) => r.typeName === "shape" && r.parentId === parentId)
			.map((r) => (r as TLShape).index)
			.sort();
		const id = `shape:${crypto.randomUUID()}`;
		createdShapes[ref] = id;
		return {
			id,
			typeName: "shape",
			type,
			x,
			y,
			rotation: 0,
			index: getIndexAbove(indices.at(-1) as IndexKey | undefined),
			parentId,
			isLocked: false,
			opacity: 1,
			meta: {},
		};
	}
	if (command.action === "delete") {
		const ids = new Set(command.shapeIds);
		for (const id of ids) shape(id);
		for (const record of Object.values(records)) {
			if (record.typeName === "shape" && ids.has(record.parentId))
				invalid("Delete shapes with children in the canvas editor.");
			if (record.typeName !== "binding") continue;
			if (ids.has(record.toId) && !ids.has(record.fromId))
				invalid(
					`Delete connected shape ${record.fromId} in the same batch before deleting ${record.toId}.`,
				);
			if (ids.has(record.fromId)) deleted.add(record.id);
		}
		for (const id of ids) deleted.add(id);
		for (const id of deleted) delete records[id];
	} else
		for (const op of command.operations) {
			if (op.op === "create") {
				const pages = Object.values(records).filter(
					(r) => r.typeName === "page",
				);
				const parentId =
					op.parentId ??
					op.pageId ??
					(pages.length === 1
						? pages[0]!.id
						: invalid(
								"Specify pageId when the canvas contains multiple pages.",
							));
				const pageId = writableParent(parentId);
				if (op.pageId && op.pageId !== pageId)
					invalid("The parent does not belong to the specified canvas page.");
				const common = {
					color: op.color ?? "black",
					size: "m",
					font: "draw",
					scale: 1,
					richText: richText(op.text ?? ""),
				};
				if (op.type === "text") {
					if (op.height !== undefined)
						invalid(
							"Text height is determined by its content; set width instead.",
						);
					put({
						...base(op.ref, "text", parentId, op.x, op.y),
						props: {
							...common,
							w: op.width ?? 240,
							textAlign: "start",
							autoSize: false,
						},
					});
				} else if (op.type === "note") {
					if (op.width !== undefined || op.height !== undefined)
						invalid(
							"Notes use their native fixed size; omit width and height.",
						);
					put({
						...base(op.ref, "note", parentId, op.x, op.y),
						props: {
							...common,
							align: "middle",
							verticalAlign: "middle",
							labelColor: "black",
							growY: 0,
							fontSizeAdjustment: 1,
							url: "",
							textLastEditedBy: null,
						},
					});
				} else {
					put({
						...base(op.ref, "geo", parentId, op.x, op.y),
						props: {
							...common,
							w: op.width ?? 240,
							h: op.height ?? 120,
							geo: op.type,
							dash: "draw",
							growY: 0,
							url: "",
							flipX: false,
							flipY: false,
							labelColor: "black",
							fill: "none",
							align: "middle",
							verticalAlign: "middle",
						},
					});
				}
			} else if (op.op === "update") {
				const current = shape(op.shapeId);
				if (
					current.type === "arrow" &&
					(op.x !== undefined || op.y !== undefined)
				)
					invalid("Move connected nodes rather than translating an arrow.");
				if (
					op.width !== undefined &&
					current.type !== "geo" &&
					current.type !== "text"
				)
					invalid("Only geometry and text shapes support width edits.");
				if (op.height !== undefined && current.type !== "geo")
					invalid("Only geometry shapes support height edits.");
				put({
					...current,
					...(op.x !== undefined ? { x: op.x } : {}),
					...(op.y !== undefined ? { y: op.y } : {}),
					props: {
						...current.props,
						...(op.width !== undefined
							? {
									w: op.width,
									...(current.type === "text" ? { autoSize: false } : {}),
								}
							: {}),
						...(op.height !== undefined ? { h: op.height, growY: 0 } : {}),
						...(op.color !== undefined ? { color: op.color } : {}),
						...(op.text !== undefined ? { richText: richText(op.text) } : {}),
					},
				});
			} else {
				const from = shape(op.fromId),
					to = shape(op.toId);
				if (from.id === to.id || from.parentId !== to.parentId)
					invalid(
						"Connections require distinct shapes with the same immediate parent (page, group or frame).",
					);
				if (from.type === "arrow" || to.type === "arrow")
					invalid("Arrows cannot connect to other arrows.");
				const arrow = {
					...base(op.ref, "arrow", from.parentId, from.x, from.y),
					props: {
						kind: "arc",
						elbowMidPoint: 0.5,
						dash: "draw",
						size: "m",
						fill: "none",
						color: op.color ?? "black",
						labelColor: "black",
						bend: 0,
						start: { x: 0, y: 0 },
						end: { x: to.x - from.x, y: to.y - from.y },
						arrowheadStart: "none",
						arrowheadEnd: "arrow",
						richText: richText(op.text ?? ""),
						labelPosition: 0.5,
						font: "draw",
						scale: 1,
					},
				};
				put(arrow);
				for (const [terminal, target] of [
					["start", from],
					["end", to],
				] as const)
					put({
						id: `binding:${crypto.randomUUID()}`,
						typeName: "binding",
						type: "arrow",
						fromId: arrow.id,
						toId: target.id,
						props: {
							terminal,
							normalizedAnchor: { x: 0.5, y: 0.5 },
							isExact: false,
							isPrecise: true,
							snap: "none",
						},
						meta: {},
					});
			}
		}
	// Native tldraw dissolves groups with fewer than two children. Avoid
	// implicitly deleting a group or reparenting an unaddressed sibling (and
	// its bindings) when the agent only requested a leaf-shape deletion.
	const childCounts = new Map<string, number>();
	for (const record of Object.values(records)) {
		if (record.typeName === "shape")
			childCounts.set(
				record.parentId,
				(childCounts.get(record.parentId) ?? 0) + 1,
			);
	}
	for (const id of touchedGroups) {
		if ((childCounts.get(id) ?? 0) < 2)
			invalid(
				`Group ${id} must retain at least two children. Ungroup or remove it in the canvas editor.`,
			);
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
		changed: [...changed.values()],
		deleted: [...deleted] as TLRecord["id"][],
		createdShapes,
	};
}

export function describeCanvas(snapshot: TLStoreSnapshot) {
	const records = Object.values(snapshot.store);
	return {
		pages: records
			.filter((r) => r.typeName === "page")
			.map((r) => ({ id: r.id, name: r.name })),
		shapes: records
			.filter((r) => r.typeName === "shape")
			.map((r) => ({
				id: r.id,
				type: r.type,
				parentId: r.parentId,
				x: r.x,
				y: r.y,
				rotation: r.rotation,
				isLocked: r.isLocked,
				text: canvasText("richText" in r.props ? r.props.richText : undefined),
				props: { ...r.props },
			})),
		bindings: records
			.filter((r) => r.typeName === "binding")
			.map((r) => ({
				id: r.id,
				type: r.type,
				fromId: r.fromId,
				toId: r.toId,
				props: { ...r.props },
			})),
	};
}

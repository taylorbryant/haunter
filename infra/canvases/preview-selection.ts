import type {
	TLPageId,
	TLRecord,
	TLShape,
	TLStoreSnapshot,
} from "@tldraw/tlschema";
import type { CanvasCommand } from "@/features/canvases/editing";
import { appError } from "@/features/shared/errors";

const supported = new Set([
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
const invalid = (message: string): never => {
	throw appError("InvalidCanvasPreview", { message });
};

/** Restrict the browser's input to one bounded page without external asset records. */
export function prepareCanvasPreview(
	snapshot: TLStoreSnapshot,
	command: Extract<CanvasCommand, { action: "preview" }>,
) {
	const pages = Object.values(snapshot.store).filter(
		(r) => r.typeName === "page",
	);
	const pageId =
		command.pageId ?? (pages.length === 1 ? pages[0].id : undefined);
	if (!pageId)
		return invalid(
			"Specify pageId for a canvas with multiple pages. Use read_canvas to list pages.",
		);
	if (snapshot.store[pageId as TLPageId]?.typeName !== "page")
		return invalid("The canvas page does not exist.");
	const shapes = Object.values(snapshot.store).filter(
		(r): r is TLShape => r.typeName === "shape",
	);
	function ancestors(shape: TLShape) {
		const ids = new Set<string>([shape.id]);
		let parent = snapshot.store[shape.parentId];
		while (parent?.typeName === "shape") {
			if (ids.has(parent.id) || ids.size > 100)
				return invalid("The canvas has an unsupported shape hierarchy.");
			ids.add(parent.id);
			parent = snapshot.store[parent.parentId];
		}
		if (parent?.typeName !== "page")
			return invalid("The canvas has a shape without a valid page.");
		return { page: parent.id, ids };
	}
	const pageShapes = shapes
		.map((shape) => ({ shape, ...ancestors(shape) }))
		.filter((r) => r.page === pageId);
	if (pageShapes.length > 1000)
		return invalid("Preview pages are limited to 1000 shapes.");
	const pageShapeIds = new Set(pageShapes.map((r) => r.shape.id));
	const requested = new Set(command.shapeIds);
	for (const id of requested)
		if (!pageShapeIds.has(id as TLShape["id"]))
			return invalid(`Shape ${id} is not on the selected canvas page.`);
	const selected = pageShapes.filter(
		({ ids }) => !command.shapeIds || [...ids].some((id) => requested.has(id)),
	);
	for (const { shape } of selected) {
		if (!supported.has(shape.type))
			return invalid(
				`Previews do not support ${shape.type} shapes. Select native diagram shapes with shapeIds.`,
			);
	}
	const store: Record<string, TLRecord> = {};
	for (const r of Object.values(snapshot.store)) {
		if (
			r.typeName === "document" ||
			r.id === pageId ||
			(r.typeName === "shape" && pageShapeIds.has(r.id)) ||
			(r.typeName === "binding" &&
				pageShapeIds.has(r.fromId) &&
				pageShapeIds.has(r.toId))
		)
			store[r.id] = r;
	}
	return {
		snapshot: { schema: snapshot.schema, store },
		pageId,
		shapeIds: selected.map((r) => r.shape.id),
	};
}

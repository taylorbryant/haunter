import type { TLStoreSnapshot, TLShapeId } from "@tldraw/tlschema";
import type { CanvasCommand } from "@/features/canvases/editing";

/** Preserve the browser-free fast path for existing leaf-only edits. */
export function needsCanvasStructureEditor(
	snapshot: TLStoreSnapshot,
	command: Extract<CanvasCommand, { action: "edit" | "delete" }>,
): boolean {
	return (
		command.action === "edit" &&
		command.operations.some((op) => {
			if (op.op === "create") return op.type === "frame";
			if (op.op === "connect") return false;
			if (op.op === "update") {
				const record = snapshot.store[op.shapeId as TLShapeId];
				return (
					record?.typeName === "shape" &&
					["group", "frame"].includes(record.type)
				);
			}
			return true;
		})
	);
}

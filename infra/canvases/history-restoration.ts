import type { TLStoreSnapshot } from "@tldraw/tlschema";
import { normalizeCanvasSnapshot } from "@/features/canvases/lib/document";
import type { PreparedCanvasEdit } from "@/features/canvases/ports";
import { appError } from "@/features/shared/errors";

/** Restore document records through the live room's ordinary diff path. Session
 * state (camera, selection, presence) and collaboration clocks are never loaded
 * from history. Whole-document restoration includes locked shapes and assets. */
export function prepareCanvasHistoryRestoration(
	before: TLStoreSnapshot,
	snapshotJson: string,
): PreparedCanvasEdit {
	let next: TLStoreSnapshot;
	try {
		const snapshot: unknown = JSON.parse(snapshotJson);
		if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
			throw new Error("Invalid canvas snapshot");
		next = normalizeCanvasSnapshot(snapshot as Record<string, unknown>);
	} catch {
		throw appError("InvalidCanvasEdit", {
			message: "This canvas history version cannot be restored.",
		});
	}
	return {
		next,
		changed: Object.values(next.store).filter(
			(record) =>
				JSON.stringify(before.store[record.id]) !== JSON.stringify(record),
		),
		deleted: Object.values(before.store)
			.filter((record) => !Object.hasOwn(next.store, record.id))
			.map((record) => record.id),
		createdShapes: {},
	};
}

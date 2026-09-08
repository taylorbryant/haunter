/** Import-only decoder for recovery files created by the abandoned canvas Yjs prototype. */
import * as Y from "yjs";
import type { TLRecord } from "@tldraw/tlschema";
import {
	DOCUMENT_META,
	DOCUMENT_SCHEMA_VERSION,
} from "@/features/documents/model";
import {
	canvasSchema,
	normalizeCanvasSnapshot,
} from "@/features/canvases/lib/document";
const CANVAS_RECORDS = "records";
const equal = (a: unknown, b: unknown) =>
	JSON.stringify(a) === JSON.stringify(b);
export function projectCanvas(doc: Y.Doc) {
	const meta = doc.getMap(DOCUMENT_META);
	if (
		meta.get("schemaVersion") !== DOCUMENT_SCHEMA_VERSION ||
		meta.get("kind") !== "canvas"
	)
		throw new Error("Unsupported canvas document");
	// Incompatible editor upgrades require an explicit migration, not a silent projection change.
	if (!equal(meta.get("tldrawSchema"), canvasSchema.serialize()))
		throw new Error("Canvas schema requires migration");
	const records = doc.getMap<Y.Map<unknown>>(CANVAS_RECORDS);
	const store: Record<string, TLRecord> = {};
	for (const [id, value] of records) {
		if (!(value instanceof Y.Map))
			throw new Error("Invalid shared canvas record");
		const record = value.toJSON() as TLRecord;
		if (canvasSchema.types[record.typeName]?.scope !== "document")
			throw new Error("Only canvas document records may be persisted");
		store[id] = record;
	}
	return normalizeCanvasSnapshot({ store, schema: meta.get("tldrawSchema") });
}

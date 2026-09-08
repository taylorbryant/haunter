import {
	createTLSchema,
	type TLRecord,
	type TLStoreSnapshot,
} from "@tldraw/tlschema";
import type { RoomSnapshot } from "@tldraw/sync-core";
export const canvasSchema = createTLSchema();
export const CANVAS_SYNC_VERSION = 1;
export function normalizeCanvasSnapshot(
	snapshot: Record<string, unknown>,
): TLStoreSnapshot {
	if (Object.keys(snapshot).length === 0)
		snapshot = {
			schema: canvasSchema.serialize(),
			store: {
				"document:document": {
					id: "document:document",
					typeName: "document",
					gridSize: 10,
					name: "",
					meta: {},
				},
				"page:page": {
					id: "page:page",
					typeName: "page",
					name: "Page 1",
					index: "a1",
					meta: {},
				},
			},
		};
	const migrated = canvasSchema.migrateStoreSnapshot(
		snapshot as unknown as TLStoreSnapshot,
	);
	if (migrated.type !== "success") throw new Error("Unsupported canvas schema");
	const store: Record<string, TLRecord> = {};
	for (const [id, record] of Object.entries(migrated.value)) {
		const type = canvasSchema.types[record.typeName];
		if (!type) throw new Error("Unsupported canvas record");
		// Legacy snapshots may include the author's camera/selection. Never share those.
		if (type.scope !== "document") continue;
		if (record.id !== id) throw new Error("Canvas record ID mismatch");
		store[id] = type.validate(record);
	}
	if (
		!store["document:document"] ||
		!Object.values(store).some((record) => record.typeName === "page")
	)
		throw new Error("Canvas requires a document and a page");
	if (
		Object.keys(store).length > 30_000 ||
		JSON.stringify(store).length > 5_000_000
	)
		throw new Error("Canvas exceeds content limits");
	return { store, schema: canvasSchema.serialize() };
}

export function createCanvasRoom(
	snapshot: Record<string, unknown>,
): RoomSnapshot {
	const normalized = normalizeCanvasSnapshot(snapshot);
	return {
		documentClock: 0,
		tombstoneHistoryStartsAtClock: 0,
		schema: normalized.schema,
		documents: Object.values(normalized.store).map((state) => ({
			state,
			lastChangedClock: 0,
		})),
	};
}
export function projectCanvasRoom(room: RoomSnapshot): TLStoreSnapshot {
	if (!Array.isArray(room.documents)) throw new Error("Invalid canvas room");
	const store: Record<string, unknown> = {};
	for (const { state } of room.documents) {
		if (store[state.id]) throw new Error("Duplicate canvas record");
		store[state.id] = state;
	}
	return normalizeCanvasSnapshot({ store, schema: room.schema });
}
export function canonicalCanvas(snapshot: TLStoreSnapshot): string {
	return JSON.stringify(snapshot, (_key, value) =>
		value && typeof value === "object" && !Array.isArray(value)
			? Object.fromEntries(
					Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
				)
			: value,
	);
}
export async function canvasFingerprint(
	snapshot: TLStoreSnapshot,
): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(canonicalCanvas(snapshot)),
	);
	return Array.from(new Uint8Array(digest), (n) =>
		n.toString(16).padStart(2, "0"),
	).join("");
}

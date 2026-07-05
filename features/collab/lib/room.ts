const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Liveblocks room naming. One room per page and one per canvas; the entity
 * id is the only client-controlled input, so parsing is strict — anything
 * that isn't exactly `page:<uuid>` or `canvas:<uuid>` is rejected before it
 * reaches a database lookup.
 */
export type RoomTarget = { kind: "page" | "canvas"; id: string };

export function pageRoomId(pageId: string): string {
	return `page:${pageId}`;
}

export function canvasRoomId(canvasId: string): string {
	return `canvas:${canvasId}`;
}

export function parseRoomId(room: string): RoomTarget | null {
	const [kind, id, ...rest] = room.split(":");
	if (rest.length > 0 || !id) return null;
	if (kind !== "page" && kind !== "canvas") return null;
	const normalized = id.toLowerCase();
	return UUID_PATTERN.test(normalized) ? { kind, id: normalized } : null;
}

/**
 * Deterministic cursor color per user id, from a small palette that reads
 * well on both themes.
 */
const CURSOR_COLORS = [
	"#e0554d",
	"#3b82f6",
	"#10b981",
	"#f59e0b",
	"#8b5cf6",
	"#ec4899",
	"#14b8a6",
	"#f97316",
];

export function cursorColorFor(userId: string): string {
	let hash = 0;
	for (const char of userId) {
		hash = (hash * 31 + char.charCodeAt(0)) | 0;
	}
	return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}

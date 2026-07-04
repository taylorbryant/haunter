const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Liveblocks room naming. One room per page; the page id is the only
 * client-controlled input, so parsing is strict — anything that isn't
 * exactly `page:<uuid>` is rejected before it reaches a database lookup.
 */
export function pageRoomId(pageId: string): string {
	return `page:${pageId}`;
}

export function parsePageRoomId(room: string): string | null {
	if (!room.startsWith("page:")) return null;
	const pageId = room.slice("page:".length).toLowerCase();
	return UUID_PATTERN.test(pageId) ? pageId : null;
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

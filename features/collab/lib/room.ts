const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Liveblocks room naming. One room per page and one per canvas; the entity
 * id is the only client-controlled input, so parsing is strict — anything
 * that isn't exactly a workspace event channel or v2
 * `doc:v2:<kind>:<uuid>` document is rejected before database lookup.
 */
export type RoomTarget =
	| {
			kind: "page" | "canvas";
			id: string;
	  }
	| {
			kind: "workspace";
			id: string;
	  };

export function workspaceRoomId(workspaceId: string): string {
	return `workspace:${workspaceId}`;
}

export function documentRoomId(
	kind: "page" | "canvas",
	entityId: string,
): string {
	return `doc:v2:${kind}:${entityId}`;
}

/**
 * V2 rooms are created inside the Liveblocks organization that corresponds to
 * their Haunter workspace. Access tokens must carry the same organization id;
 * room-level permissions alone do not cross an organization boundary.
 */
export function liveblocksSessionOptions(input: {
	workspaceId: string;
	userName: string;
}) {
	return {
		organizationId: input.workspaceId,
		userInfo: { name: input.userName },
	};
}

export function parseRoomId(room: string): RoomTarget | null {
	const parts = room.split(":");
	if (parts.length === 2 && parts[0] === "workspace") {
		const workspaceId = parts[1];
		return workspaceId && /^[A-Za-z0-9_-]{1,128}$/.test(workspaceId)
			? { kind: "workspace", id: workspaceId }
			: null;
	}
	if (parts.length !== 4 || parts[0] !== "doc" || parts[1] !== "v2") {
		return null;
	}
	const kind = parts[2];
	const id = parts[3];
	if (!id) return null;
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

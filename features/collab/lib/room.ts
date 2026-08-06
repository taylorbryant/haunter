/** One private, storage-free Liveblocks room per Haunter workspace. */
export type WorkspaceRoomTarget = { kind: "workspace"; id: string };

export function workspaceRoomId(workspaceId: string): string {
	return `workspace:${workspaceId}`;
}

export function parseRoomId(room: string): WorkspaceRoomTarget | null {
	const parts = room.split(":");
	if (parts.length !== 2 || parts[0] !== "workspace") return null;
	const workspaceId = parts[1];
	return workspaceId && /^[A-Za-z0-9_-]{1,128}$/.test(workspaceId)
		? { kind: "workspace", id: workspaceId }
		: null;
}

export function liveblocksSessionOptions(input: {
	workspaceId: string;
	userName: string;
}) {
	return {
		organizationId: input.workspaceId,
		userInfo: { name: input.userName },
	};
}

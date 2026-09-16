/** A server wall-clock reference anchored to this browser's monotonic clock. */
export type WorkspaceEventClock = {
	serverTime: number;
	receivedAt: number;
};

export function readWorkspaceEventClock(
	value: unknown,
	receivedAt = performance.now(),
): WorkspaceEventClock | null {
	if (typeof value !== "object" || value === null || !("serverTime" in value))
		return null;
	const serverTime = value.serverTime;
	if (
		typeof serverTime !== "number" ||
		!Number.isSafeInteger(serverTime) ||
		serverTime < 0 ||
		serverTime > 8.64e15
	)
		return null;
	return { serverTime, receivedAt };
}

export function estimatedWorkspaceServerTime(
	clock: WorkspaceEventClock,
	now = performance.now(),
) {
	return clock.serverTime + Math.max(0, now - clock.receivedAt);
}

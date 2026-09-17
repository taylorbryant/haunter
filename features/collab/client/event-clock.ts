import { WORKSPACE_EVENT_TIME_HEADER } from "../headers";

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

/** Each stream calibrates independently; an obsolete response cannot reset it. */
export function createWorkspaceEventClockFetch(
	fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) {
	let clock: WorkspaceEventClock | null = null;
	let generation = 0;
	let signal: AbortSignal | null | undefined;
	return {
		async fetch(input: RequestInfo | URL, init?: RequestInit) {
			const requestGeneration = ++generation;
			clock = null;
			signal = init?.signal;
			const response = await fetcher(input, init);
			if (requestGeneration === generation && !signal?.aborted && response.ok) {
				const value = response.headers.get(WORKSPACE_EVENT_TIME_HEADER);
				if (value && /^\d+$/.test(value))
					clock = readWorkspaceEventClock({ serverTime: Number(value) });
			}
			return response;
		},
		getClock: () => (signal?.aborted ? null : clock),
		clear() {
			generation++;
			clock = null;
		},
	};
}

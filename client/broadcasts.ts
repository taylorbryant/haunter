import { createBroadcastClient } from "@beignet/core/broadcasting/client";
import { createWorkspaceEventClockFetch } from "@/features/collab/client/event-clock";
import { sessionFetch } from "./session-recovery";

/** One client for the mounted workspace; its owner closes it on session changes. */
export function createAppBroadcastClient(
	fetcher: (
		input: RequestInfo | URL,
		init?: RequestInit,
	) => Promise<Response> = sessionFetch,
) {
	const clock = createWorkspaceEventClockFetch(fetcher);
	const client = createBroadcastClient({
		url: "/api/broadcasts",
		fetch: clock.fetch,
	});
	return {
		...client,
		getClock: clock.getClock,
		close() {
			clock.clear();
			client.close();
		},
	};
}

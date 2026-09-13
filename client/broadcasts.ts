import { createBroadcastClient } from "@beignet/core/broadcasting/client";
import { sessionFetch } from "./session-recovery";

/** One client for the mounted workspace; its owner closes it on session changes. */
export function createAppBroadcastClient() {
	return createBroadcastClient({ url: "/api/broadcasts", fetch: sessionFetch });
}

"use client";

import { type Client, createClient } from "@liveblocks/client";
import { LiveblocksYjsProvider } from "@liveblocks/yjs";
import * as Y from "yjs";
import type { CollabMode, CollabRoom } from "./session";

/**
 * The Liveblocks/Yjs runtime. Never import this module statically from app
 * code — ./session reaches it via dynamic import once a collab mode is
 * configured, which keeps @liveblocks/client, @liveblocks/yjs, and yjs out
 * of the route bundles when collaboration is off.
 */

let client: Client | null = null;

function getLiveblocksClient(mode: CollabMode): Client {
	if (!client) {
		client =
			mode === "auth"
				? createClient({ authEndpoint: "/api/liveblocks-auth" })
				: createClient({
						publicApiKey: process.env.NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY ?? "",
					});
	}
	return client;
}

type CachedRoom = {
	doc: Y.Doc;
	provider: LiveblocksYjsProvider;
	leave: () => void;
	refs: number;
	linger: ReturnType<typeof setTimeout> | null;
};

/**
 * Rooms are ref-counted and linger briefly after their last consumer
 * unmounts: connecting + initial sync costs ~0.5s, so tearing the room down
 * on every navigation made hopping between pages feel slow. Revisiting a
 * lingering room is instant (already synced).
 */
const roomCache = new Map<string, CachedRoom>();
// Five minutes: the cold websocket upgrade to Liveblocks costs 1-2s
// (server-side), so lingering rooms longer keeps typical hop-between-pages
// sessions instant. Lingering docs are small; memory is not a concern at
// this scale.
const ROOM_LINGER_MS = 5 * 60_000;

function acquireRoom(mode: CollabMode, roomId: string): CachedRoom {
	const cached = roomCache.get(roomId);
	if (cached) {
		if (cached.linger) {
			clearTimeout(cached.linger);
			cached.linger = null;
		}
		cached.refs += 1;
		return cached;
	}
	const { room, leave } = getLiveblocksClient(mode).enterRoom(roomId);
	const doc = new Y.Doc();
	const provider = new LiveblocksYjsProvider(room, doc);
	const entry: CachedRoom = { doc, provider, leave, refs: 1, linger: null };
	roomCache.set(roomId, entry);
	return entry;
}

function releaseRoom(roomId: string) {
	const entry = roomCache.get(roomId);
	if (!entry) return;
	entry.refs -= 1;
	if (entry.refs > 0) return;
	// No consumers left: drop this client from peers' presence right away
	// (no ghost cursors while the room lingers), tear down after the linger.
	entry.provider.awareness.setLocalState(null);
	entry.linger = setTimeout(() => {
		roomCache.delete(roomId);
		entry.provider.destroy();
		entry.leave();
		entry.doc.destroy();
	}, ROOM_LINGER_MS);
}

/**
 * Bind one consumer to a room: acquire (or reuse) the cached room, push a
 * fresh CollabRoom snapshot into onChange as sync state changes, and return
 * the cleanup that unsubscribes and releases the reference.
 */
export function bindRoom(
	mode: CollabMode,
	roomId: string,
	onChange: (room: CollabRoom) => void,
): () => void {
	const { doc, provider } = acquireRoom(mode, roomId);
	const update = () =>
		onChange({ doc, provider, synced: provider.synced === true });
	provider.on("synced", update);
	provider.on("sync", update);
	update();
	return () => {
		provider.off("synced", update);
		provider.off("sync", update);
		releaseRoom(roomId);
	};
}

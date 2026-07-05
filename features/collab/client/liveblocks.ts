"use client";

import { type Client, createClient } from "@liveblocks/client";
import { LiveblocksYjsProvider } from "@liveblocks/yjs";
import { useEffect, useState } from "react";
import * as Y from "yjs";

/**
 * How this client connects to Liveblocks:
 * - "auth": through POST /api/liveblocks-auth, which checks workspace
 *   membership per room and hands viewers read-only tokens. Requires
 *   LIVEBLOCKS_SECRET_KEY on the server plus NEXT_PUBLIC_LIVEBLOCKS_AUTH=true.
 * - "public": directly with the public key — Liveblocks' prototyping mode.
 *   Anyone holding the (bundled) public key can join any room, so this is
 *   only as private as the room ids; switch to "auth" before inviting
 *   anyone you don't trust.
 * - null: collaboration off; editors, titles, and canvases run the original
 *   local paths (CAS-protected saves, no rooms, no presence).
 *
 * Collaboration is opt-in: NEXT_PUBLIC_ENABLE_COLLABORATION must be "true"
 * (in addition to the Liveblocks keys) or everything runs local-only.
 * NEXT_PUBLIC_ vars are inlined at build time, so flipping the switch takes
 * a rebuild/redeploy.
 */
export type CollabMode = "auth" | "public";

export function getCollabMode(): CollabMode | null {
	if (process.env.NEXT_PUBLIC_ENABLE_COLLABORATION !== "true") return null;
	if (process.env.NEXT_PUBLIC_LIVEBLOCKS_AUTH === "true") return "auth";
	if (process.env.NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY) return "public";
	return null;
}

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

export type CollabRoom = {
	doc: Y.Doc;
	provider: LiveblocksYjsProvider;
	/** True once the initial server document has been applied to the doc. */
	synced: boolean;
};

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
 * Enter a Liveblocks room and bind a Y.Doc to it. Returns null until the
 * room connection exists; `synced` flips once the server state has loaded,
 * which is when the editor may mount (it must know whether the shared doc
 * is empty before deciding to seed it).
 */
export function useCollabRoom(
	roomId: string,
	mode: CollabMode | null,
): CollabRoom | null {
	const [room, setRoom] = useState<CollabRoom | null>(null);

	useEffect(() => {
		if (!mode) return;
		const { doc, provider } = acquireRoom(mode, roomId);
		const update = () =>
			setRoom({ doc, provider, synced: provider.synced === true });
		provider.on("synced", update);
		provider.on("sync", update);
		update();

		return () => {
			provider.off("synced", update);
			provider.off("sync", update);
			setRoom(null);
			releaseRoom(roomId);
		};
	}, [roomId, mode]);

	return mode ? room : null;
}

const COLLAB_CONNECT_TIMEOUT_MS = 8000;

export type CollabSession =
	/** Collaboration is not configured; run the local-only path. */
	| { status: "off" }
	/** Room joined, waiting for the initial server doc. */
	| { status: "connecting" }
	/** Shared doc loaded; safe to bind editors to it. */
	| { status: "ready"; room: CollabRoom }
	/** Liveblocks didn't sync in time; run local so writing is never blocked. */
	| { status: "fallback" };

/**
 * The full collaboration lifecycle for one room, including the connect
 * timeout. Consumers render a loading state during "connecting" and treat
 * "off" and "fallback" identically (local, non-collaborative behavior).
 */
export function useCollabSession(roomId: string): CollabSession {
	const mode = getCollabMode();
	const room = useCollabRoom(roomId, mode);
	const [fallback, setFallback] = useState(false);
	const synced = room?.synced === true;

	useEffect(() => {
		if (!mode || synced || fallback) return;
		const timer = setTimeout(
			() => setFallback(true),
			COLLAB_CONNECT_TIMEOUT_MS,
		);
		return () => clearTimeout(timer);
	}, [mode, synced, fallback]);

	if (!mode) return { status: "off" };
	if (fallback) return { status: "fallback" };
	if (room && synced) return { status: "ready", room };
	return { status: "connecting" };
}

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
 * - null: collaboration off; the editor runs exactly as before.
 */
export type CollabMode = "auth" | "public";

export function getCollabMode(): CollabMode | null {
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

/**
 * Enter a Liveblocks room and bind a fresh Y.Doc to it. Returns null until
 * the room connection exists; `synced` flips once the server state has
 * loaded, which is when the editor may mount (it must know whether the
 * shared doc is empty before deciding to seed it).
 */
export function useCollabRoom(
	roomId: string,
	mode: CollabMode | null,
): CollabRoom | null {
	const [room, setRoom] = useState<CollabRoom | null>(null);

	useEffect(() => {
		if (!mode) return;
		const { room: liveblocksRoom, leave } =
			getLiveblocksClient(mode).enterRoom(roomId);
		const doc = new Y.Doc();
		const provider = new LiveblocksYjsProvider(liveblocksRoom, doc);
		const update = () =>
			setRoom({ doc, provider, synced: provider.synced === true });
		provider.on("synced", update);
		provider.on("sync", update);
		update();

		return () => {
			provider.off("synced", update);
			provider.off("sync", update);
			provider.destroy();
			leave();
			doc.destroy();
			setRoom(null);
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

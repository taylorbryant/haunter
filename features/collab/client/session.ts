"use client";

import type { LiveblocksYjsProvider } from "@liveblocks/yjs";
import { useEffect, useState } from "react";
import type * as Y from "yjs";

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
 *
 * This module is intentionally light: only types, the mode gate, and the
 * session hook. The Liveblocks/Yjs runtime lives in ./liveblocks and is
 * loaded via dynamic import only when a mode is configured, so those
 * libraries stay out of the route bundles when collaboration is off.
 */
export type CollabMode = "auth" | "public";

export function getCollabMode(): CollabMode | null {
	if (process.env.NEXT_PUBLIC_ENABLE_COLLABORATION !== "true") return null;
	if (process.env.NEXT_PUBLIC_LIVEBLOCKS_AUTH === "true") return "auth";
	if (process.env.NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY) return "public";
	return null;
}

export type CollabRoom = {
	doc: Y.Doc;
	provider: LiveblocksYjsProvider;
	/** True once the initial server document has been applied to the doc. */
	synced: boolean;
};

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
	const [room, setRoom] = useState<CollabRoom | null>(null);
	const [fallback, setFallback] = useState(false);
	const synced = room?.synced === true;

	useEffect(() => {
		if (!mode) return;
		let disposed = false;
		let unbind: (() => void) | null = null;
		void import("./liveblocks").then(({ bindRoom }) => {
			if (disposed) return;
			unbind = bindRoom(mode, roomId, setRoom);
		});
		return () => {
			disposed = true;
			unbind?.();
			setRoom(null);
		};
	}, [roomId, mode]);

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

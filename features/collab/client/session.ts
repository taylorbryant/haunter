"use client";

import type { LiveblocksYjsProvider } from "@liveblocks/yjs";
import { useEffect, useState } from "react";
import type * as Y from "yjs";

/** The browser always joins private Liveblocks rooms through the authenticated
 * endpoint. If room setup or synchronization fails, consumers fail closed and
 * render the last SQLite projection read-only. */

export type CollabRoom = {
	doc: Y.Doc;
	provider: LiveblocksYjsProvider;
	/** True once the initial server document has been applied to the doc. */
	synced: boolean;
};

const COLLAB_CONNECT_TIMEOUT_MS = 8000;
const COLLAB_PERSIST_TIMEOUT_MS = 8000;
// Liveblocks hashes local snapshots after a 200ms debounce. Waiting for a
// slightly longer quiet period prevents an old "synchronized" status from
// being mistaken for acknowledgement of the edit that just happened.
const COLLAB_LOCAL_QUIET_MS = 225;

/** Wait until all local Yjs updates through this room are acknowledged by the
 * provider. SQLite projection is deliberately separate: callers that need
 * fresh content must read the authoritative document rather than assuming an
 * asynchronous materialization job has completed. */
export function waitForCollabPersistence(
	room: CollabRoom,
	timeoutMs = COLLAB_PERSIST_TIMEOUT_MS,
): Promise<boolean> {
	return new Promise((resolve) => {
		let settled = false;
		let quiet = false;
		let quietTimer: ReturnType<typeof setTimeout> | null = null;
		let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

		const finish = (persisted: boolean) => {
			if (settled) return;
			settled = true;
			if (quietTimer) clearTimeout(quietTimer);
			if (timeoutTimer) clearTimeout(timeoutTimer);
			room.doc.off("update", handleDocumentUpdate);
			room.provider.off("status", handleStatus);
			resolve(persisted);
		};
		const maybeFinish = () => {
			if (quiet && room.provider.getStatus() === "synchronized") finish(true);
		};
		const scheduleQuietCheck = () => {
			quiet = false;
			if (quietTimer) clearTimeout(quietTimer);
			quietTimer = setTimeout(() => {
				quiet = true;
				maybeFinish();
			}, COLLAB_LOCAL_QUIET_MS);
		};
		function handleDocumentUpdate(_update: Uint8Array, origin: unknown) {
			// Liveblocks applies server and collaborator updates with its backend
			// origin. They do not represent new local work and must not keep a local
			// save pending while another person continues editing the room.
			if (origin === "backend") return;
			scheduleQuietCheck();
		}
		function handleStatus() {
			maybeFinish();
		}

		room.doc.on("update", handleDocumentUpdate);
		room.provider.on("status", handleStatus);
		timeoutTimer = setTimeout(() => finish(false), timeoutMs);
		scheduleQuietCheck();
	});
}

export type CollabSession =
	/** Room joined, waiting for the initial server doc. */
	| { status: "connecting" }
	/** Shared doc loaded; safe to bind editors to it. */
	| { status: "ready"; room: CollabRoom }
	/** The authoritative document is unavailable; projections stay read-only. */
	| { status: "unavailable" };

/**
 * The full collaboration lifecycle for one room, including the connect
 * timeout. Consumers render a loading state during "connecting" and the last
 * materialized projection read-only when the authoritative room is unavailable.
 */
export function useCollabSession(roomId: string): CollabSession {
	const [room, setRoom] = useState<CollabRoom | null>(null);
	const [unavailable, setUnavailable] = useState(false);
	const synced = room?.synced === true;

	useEffect(() => {
		setRoom(null);
		setUnavailable(false);
		let disposed = false;
		let unbind: (() => void) | null = null;
		void import("./liveblocks").then(({ bindRoom }) => {
			if (disposed) return;
			unbind = bindRoom(roomId, setRoom);
		});
		return () => {
			disposed = true;
			unbind?.();
			setRoom(null);
		};
	}, [roomId]);

	useEffect(() => {
		if (synced) {
			// A slow initial websocket/auth handshake can outlive the bounded
			// read-only fallback. Recover automatically when that same room finally
			// synchronizes instead of requiring a page reload.
			setUnavailable(false);
			return;
		}
		const timer = setTimeout(
			() => setUnavailable(true),
			COLLAB_CONNECT_TIMEOUT_MS,
		);
		return () => clearTimeout(timer);
	}, [synced]);

	if (unavailable) return { status: "unavailable" };
	if (room && synced) return { status: "ready", room };
	return { status: "connecting" };
}

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
	/** Server-issued provider-document incarnation used by the local cache. */
	cacheEpoch: string | null;
	/** True once the initial server document has been applied to the doc. */
	synced: boolean;
	/** True once a valid, server-seeded document has loaded from this user's
	 * local IndexedDB cache. Remote synchronization may still be in progress. */
	localReady: boolean;
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
	| { status: "ready"; room: CollabRoom; remoteUnavailable: boolean }
	/** The authoritative document is unavailable; projections stay read-only. */
	| { status: "unavailable" };

export function isCollabRoomReady(
	room: CollabRoom | null,
	allowLocalReady = true,
): boolean {
	return (
		room?.synced === true || (allowLocalReady && room?.localReady === true)
	);
}

/** Local-first rendering is safe only for members who can eventually write
 * the cached state back to the room. Viewers always start from the remote doc,
 * so private edits cached before a role downgrade cannot remain visible. */
export function localCacheEpochForSession(
	cacheEpoch: string | null,
	allowLocalReady: boolean,
): string | null {
	return allowLocalReady ? cacheEpoch : null;
}

/** A locally hydrated room may render immediately, but it must stay read-only
 * until Liveblocks has synchronized the authoritative document. */
export function canWriteToCollabRoom(
	room: CollabRoom | null,
	canEdit: boolean,
): boolean {
	return canEdit && room?.synced === true;
}

/**
 * The full collaboration lifecycle for one room, including the connect
 * timeout. Consumers render a loading state during "connecting" and the last
 * materialized projection read-only when the authoritative room is unavailable.
 */
export function useCollabSession(
	roomId: string,
	userId: string | null,
	options: {
		/** Undefined while the detail request is pending; null when the server
		 * could not issue an epoch and the session must join without IndexedDB. */
		cacheEpoch: string | null | undefined;
		allowLocalReady: boolean;
	},
): CollabSession {
	const [room, setRoom] = useState<CollabRoom | null>(null);
	const [unavailable, setUnavailable] = useState(false);
	const { allowLocalReady, cacheEpoch } = options;
	const waitingForCacheEpoch = allowLocalReady && cacheEpoch === undefined;
	const localCacheEpoch = localCacheEpochForSession(
		cacheEpoch ?? null,
		allowLocalReady,
	);
	const canConnect = Boolean(userId) && !waitingForCacheEpoch;
	const ready = isCollabRoomReady(room, allowLocalReady);

	useEffect(() => {
		setRoom(null);
		setUnavailable(false);
		let disposed = false;
		let unbind: (() => void) | null = null;
		// Editors wait for the server-issued epoch before opening IndexedDB.
		// Viewers deliberately join without a local cache.
		if (!userId || waitingForCacheEpoch) return;
		void import("./liveblocks").then(({ bindRoom }) => {
			if (disposed) return;
			unbind = bindRoom(roomId, userId, localCacheEpoch, setRoom);
		});
		return () => {
			disposed = true;
			unbind?.();
			setRoom(null);
		};
	}, [localCacheEpoch, roomId, userId, waitingForCacheEpoch]);

	useEffect(() => {
		setUnavailable(false);
		if (!canConnect) return;
		if (room?.synced) {
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
	}, [canConnect, room?.synced]);

	if (room && ready) {
		return { status: "ready", room, remoteUnavailable: unavailable };
	}
	if (unavailable) return { status: "unavailable" };
	return { status: "connecting" };
}

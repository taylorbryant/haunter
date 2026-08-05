"use client";

import { type Client, createClient, type Room } from "@liveblocks/client";
import { LiveblocksYjsProvider } from "@liveblocks/yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { markLoadStage, measureLoadStage } from "@/client/load-performance";
import type { WorkspaceEvent } from "@/features/collab/workspace-events";
import {
	isUsableLocalDocument,
	isUsableRemoteDocument,
	localDocumentCacheName,
} from "./local-document-cache";
import { type PresencePeer, presencePeersFromOthers } from "./presence-state";
import type { CollabRoom } from "./session";

/**
 * The Liveblocks/Yjs browser runtime. `session.ts` loads it dynamically so
 * the collaboration libraries are initialized only when a document room is
 * mounted or deliberately preloaded in the client.
 */

const clients = new Map<string, Client>();

function getLiveblocksClient(userId: string | null): Client {
	const key = userId ? encodeURIComponent(userId) : "ephemeral";
	const cached = clients.get(key);
	if (cached) return cached;
	const created = createClient({ authEndpoint: "/api/liveblocks-auth" });
	clients.set(key, created);
	return created;
}

type RoomSubscriber = (room: CollabRoom) => void;

type CachedRoom = {
	roomId: string;
	userId: string | null;
	cacheEpoch: string | null;
	room: Room;
	doc: Y.Doc;
	provider: LiveblocksYjsProvider;
	persistence: IndexeddbPersistence | null;
	localLoaded: boolean;
	leave: () => void;
	refs: number;
	linger: ReturnType<typeof setTimeout> | null;
	subscribers: Set<RoomSubscriber>;
	onProviderSync: () => void;
	onLocalSync: (() => void) | null;
	unsubscribeStatus: () => void;
	socketConnectMeasured: boolean;
	remoteSyncMeasured: boolean;
	localSyncMeasured: boolean;
};

/** Rooms are keyed by account as well as room. This prevents a second account
 * in the same browser from seeing another account's cached document while its
 * own room authorization is still pending. */
const roomCache = new Map<string, CachedRoom>();
// Five minutes: the cold websocket upgrade to Liveblocks costs 1-2s
// (server-side), so lingering rooms longer keeps typical hop-between-pages
// sessions instant. IndexedDB handles visits after the in-memory room expires.
const ROOM_LINGER_MS = 5 * 60_000;
const ROOM_SYNC_TIMEOUT_MS = 8000;

function destroyCachedRoom(cacheKey: string, entry: CachedRoom) {
	if (entry.linger) clearTimeout(entry.linger);
	roomCache.delete(cacheKey);
	entry.provider.off("synced", entry.onProviderSync);
	entry.provider.off("sync", entry.onProviderSync);
	entry.unsubscribeStatus();
	if (entry.persistence && entry.onLocalSync) {
		entry.persistence.off("synced", entry.onLocalSync);
	}
	entry.provider.awareness.setLocalState(null);
	// Destroying the provider destroys the Y.Doc; y-indexeddb listens for that
	// event and closes its database without clearing the persisted data.
	entry.provider.destroy();
	entry.leave();
}

/** A repaired provider document keeps the same Liveblocks room id. Retire any
 * in-memory provider for the previous epoch before opening the replacement;
 * otherwise its stale Y.Doc could remain connected during the linger window
 * and merge the retired history back into the repaired room. */
function retireOtherDocumentEpochs(
	roomId: string,
	userId: string | null,
	cacheEpoch: string | null,
) {
	for (const [cacheKey, entry] of roomCache) {
		if (
			entry.roomId === roomId &&
			entry.userId === userId &&
			entry.cacheEpoch !== cacheEpoch
		) {
			destroyCachedRoom(cacheKey, entry);
		}
	}
}

function cacheKeyFor(
	roomId: string,
	userId: string | null,
	cacheEpoch: string | null,
): string {
	return `${userId ? encodeURIComponent(userId) : "ephemeral"}:${cacheEpoch ? encodeURIComponent(cacheEpoch) : "remote"}:${roomId}`;
}

function roomSnapshot(entry: CachedRoom): CollabRoom {
	const seeded = isUsableLocalDocument(entry.roomId, entry.doc);
	return {
		doc: entry.doc,
		provider: entry.provider,
		cacheEpoch: entry.cacheEpoch,
		// Provider synchronization alone is not enough: an accidentally empty or
		// partially seeded room is a valid Yjs document. Keep it read-only until
		// Haunter's server-written seed marker is present.
		synced: isUsableRemoteDocument(
			entry.roomId,
			entry.doc,
			entry.provider.synced === true,
		),
		localReady: entry.localLoaded && seeded,
	};
}

function notifyRoomSubscribers(entry: CachedRoom) {
	const snapshot = roomSnapshot(entry);
	for (const subscriber of entry.subscribers) subscriber(snapshot);
}

function acquireRoom(
	roomId: string,
	userId: string | null,
	cacheEpoch: string | null,
): CachedRoom {
	const cacheKey = cacheKeyFor(roomId, userId, cacheEpoch);
	const cached = roomCache.get(cacheKey);
	if (cached) {
		markLoadStage(`collab:${roomId}`, "room-reused");
		if (cached.linger) {
			clearTimeout(cached.linger);
			cached.linger = null;
		}
		cached.refs += 1;
		return cached;
	}
	retireOtherDocumentEpochs(roomId, userId, cacheEpoch);
	const performanceScope = `collab:${roomId}`;
	markLoadStage(performanceScope, "room-open-start");

	const { room, leave } = getLiveblocksClient(userId).enterRoom(roomId);
	const doc = new Y.Doc();
	const provider = new LiveblocksYjsProvider(room, doc);
	const persistence =
		userId && cacheEpoch
			? new IndexeddbPersistence(
					localDocumentCacheName(userId, roomId, cacheEpoch),
					doc,
				)
			: null;
	const entry: CachedRoom = {
		roomId,
		userId,
		cacheEpoch,
		room,
		doc,
		provider,
		persistence,
		localLoaded: persistence?.synced === true,
		leave,
		refs: 1,
		linger: null,
		subscribers: new Set(),
		onProviderSync: () => {
			if (provider.synced && !entry.remoteSyncMeasured) {
				entry.remoteSyncMeasured = true;
				markLoadStage(performanceScope, "remote-synced");
				measureLoadStage(
					performanceScope,
					"remote-sync-duration",
					"room-open-start",
					"remote-synced",
				);
			}
			notifyRoomSubscribers(entry);
		},
		onLocalSync: null,
		unsubscribeStatus: () => {},
		socketConnectMeasured: false,
		remoteSyncMeasured: false,
		localSyncMeasured: false,
	};
	entry.unsubscribeStatus = room.subscribe("status", (status) => {
		if (status !== "connected" || entry.socketConnectMeasured) return;
		entry.socketConnectMeasured = true;
		markLoadStage(performanceScope, "socket-connected");
		measureLoadStage(
			performanceScope,
			"socket-connect-duration",
			"room-open-start",
			"socket-connected",
		);
	});

	provider.on("synced", entry.onProviderSync);
	provider.on("sync", entry.onProviderSync);
	if (persistence) {
		entry.onLocalSync = () => {
			entry.localLoaded = true;
			if (!entry.localSyncMeasured) {
				entry.localSyncMeasured = true;
				markLoadStage(performanceScope, "local-cache-ready");
				measureLoadStage(
					performanceScope,
					"local-cache-duration",
					"room-open-start",
					"local-cache-ready",
				);
			}
			// Liveblocks intentionally does not stream IndexedDB updates one by one.
			// Re-run the state-vector exchange after the local merge so offline edits
			// are sent and remote edits are applied to this same Y.Doc in place.
			provider.rootDocHandler.syncDoc();
			notifyRoomSubscribers(entry);
		};
		persistence.on("synced", entry.onLocalSync);
	}
	roomCache.set(cacheKey, entry);
	return entry;
}

/** Subscribe to native Liveblocks presence. Unlike Yjs awareness, this also
 * includes short-lived server identities published while an agent tool runs. */
export function subscribeToRoomPresence(
	roomId: string,
	userId: string,
	cacheEpoch: string | null,
	onChange: (peers: PresencePeer[]) => void,
): () => void {
	const { room } = acquireRoom(roomId, userId, cacheEpoch);
	const update = () => onChange(presencePeersFromOthers(room.getOthers()));
	const unsubscribe = room.subscribe("others", update);
	update();
	return () => {
		unsubscribe();
		releaseRoom(roomId, userId, cacheEpoch);
	};
}

function releaseRoom(
	roomId: string,
	userId: string | null,
	cacheEpoch: string | null,
) {
	const cacheKey = cacheKeyFor(roomId, userId, cacheEpoch);
	const entry = roomCache.get(cacheKey);
	if (!entry) return;
	entry.refs -= 1;
	if (entry.refs > 0) return;
	// No consumers left: drop this client from peers' presence right away
	// (no ghost cursors while the room lingers), tear down after the linger.
	entry.provider.awareness.setLocalState(null);
	entry.linger = setTimeout(() => {
		destroyCachedRoom(cacheKey, entry);
	}, ROOM_LINGER_MS);
}

function waitForRoomSync(provider: LiveblocksYjsProvider): Promise<boolean> {
	if (provider.synced) return Promise.resolve(true);

	return new Promise((resolve) => {
		const finish = (synced: boolean) => {
			clearTimeout(timeout);
			provider.off("synced", update);
			provider.off("sync", update);
			resolve(synced);
		};
		const update = () => {
			if (provider.synced) finish(true);
		};
		const timeout = setTimeout(() => finish(false), ROOM_SYNC_TIMEOUT_MS);
		provider.on("synced", update);
		provider.on("sync", update);
	});
}

/** Run one bounded mutation against a remotely synced room without making it
 * a React session. Server-mutating helpers must not trust a local cache. */
export async function withSyncedRoom<T>(
	roomId: string,
	run: (room: CollabRoom) => T | Promise<T>,
): Promise<T | null> {
	const { doc, provider } = acquireRoom(roomId, null, null);
	try {
		if (!(await waitForRoomSync(provider))) return null;
		return await run({
			doc,
			provider,
			cacheEpoch: null,
			synced: true,
			localReady: false,
		});
	} finally {
		releaseRoom(roomId, null, null);
	}
}

/** Start loading the editor's room before navigation commits. Releasing the
 * preload reference keeps the connected room in the normal linger cache. */
export function preloadRoom(
	roomId: string,
	userId: string,
	cacheEpoch: string | null,
): void {
	acquireRoom(roomId, userId, cacheEpoch);
	releaseRoom(roomId, userId, cacheEpoch);
}

/** Bind one consumer to a room and publish readiness changes from both the
 * local IndexedDB document and the remote Liveblocks provider. */
export function bindRoom(
	roomId: string,
	userId: string,
	cacheEpoch: string | null,
	onChange: RoomSubscriber,
): () => void {
	const entry = acquireRoom(roomId, userId, cacheEpoch);
	entry.subscribers.add(onChange);
	onChange(roomSnapshot(entry));
	return () => {
		entry.subscribers.delete(onChange);
		releaseRoom(roomId, userId, cacheEpoch);
	};
}

/** Join the storage-free room used only for server-originated workspace
 * invalidation hints. Document rooms remain separately scoped per page/canvas. */
export function bindWorkspaceEvents(
	roomId: string,
	userId: string,
	input: {
		onEvent(event: WorkspaceEvent): void;
		onConnected(): void;
	},
): () => void {
	const { room, leave } = getLiveblocksClient(userId).enterRoom<
		Record<string, never>,
		Record<string, never>,
		WorkspaceEvent
	>(roomId);
	const unsubscribeEvent = room.subscribe("event", ({ event }) => {
		input.onEvent(event);
	});
	const unsubscribeStatus = room.subscribe("status", (status) => {
		if (status === "connected") input.onConnected();
	});
	if (room.getStatus() === "connected") input.onConnected();

	return () => {
		unsubscribeEvent();
		unsubscribeStatus();
		leave();
	};
}

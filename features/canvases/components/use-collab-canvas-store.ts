"use client";

import { useEffect, useRef, useState } from "react";
import {
	atom,
	createPresenceStateDerivation,
	createTLStore,
	defaultBindingUtils,
	InstancePresenceRecordType,
	loadSnapshot,
	react,
	type TLInstancePresence,
	type TLRecord,
	type TLStoreWithStatus,
	type TLUser,
} from "tldraw";
import type { Transaction, YMapEvent } from "yjs";
import { haunterShapeUtils } from "@/features/canvases/lib/shape-utils";
import { isLoadableSnapshot } from "@/features/canvases/lib/snapshot";
import type { CollabRoom } from "@/features/collab/client/session";
import { CANVAS_META_NAME } from "@/features/documents/model";

export type CanvasCollabUser = { id: string; name: string; color: string };

function toTLUser(user: CanvasCollabUser): TLUser {
	return {
		typeName: "user",
		id: `user:${user.id}` as TLUser["id"],
		name: user.name,
		color: user.color,
		imageUrl: "",
		meta: {},
	};
}

/**
 * Two-way binding between a tldraw store and a shared Y.Map of records —
 * every local document change lands in the map, every remote map change
 * lands in the store (via mergeRemoteChanges so it doesn't echo back).
 * Presence (remote cursors/selections) travels through the room's
 * awareness: the local TLInstancePresence derivation is pushed as an
 * awareness field, and peers' presence records are put into the store,
 * where tldraw renders them as live collaborator cursors.
 */
export function useCollabCanvasStore(
	room: CollabRoom,
	snapshot: Record<string, unknown>,
	user?: CanvasCollabUser,
	canEdit = true,
): TLStoreWithStatus {
	const [storeWithStatus, setStoreWithStatus] = useState<TLStoreWithStatus>({
		status: "loading",
	});
	// The DB snapshot is only the seed for a brand-new room; a refetch must
	// not rebuild the store.
	const seedSnapshotRef = useRef(snapshot);
	// The user signal outlives the binding effect: identity can arrive after
	// mount (session load) without rebuilding the store.
	const userSignalRef = useRef(atom<TLUser | null>("canvas-collab-user", null));
	useEffect(() => {
		userSignalRef.current.set(user ? toTLUser(user) : null);
	}, [user]);

	useEffect(() => {
		const store = createTLStore({
			shapeUtils: haunterShapeUtils,
			bindingUtils: defaultBindingUtils,
		});
		const yRecords = room.doc.getMap<TLRecord>("tldraw");
		const meta = room.doc.getMap<unknown>(CANVAS_META_NAME);

		if (yRecords.size > 0) {
			// The shared doc already has the drawing — it wins over the DB copy.
			store.mergeRemoteChanges(() => {
				store.put([...yRecords.values()]);
			});
		} else {
			const seed = seedSnapshotRef.current;
			if (isLoadableSnapshot(seed)) {
				loadSnapshot(store, { document: seed });
			}
			if (canEdit) {
				// Build the complete seed before opening the Yjs transaction. tldraw's
				// editor session does not exist yet, so getSnapshot(store) can throw
				// here; the document-only Store API is safe before mount. Keeping every
				// potentially-throwing operation outside the transaction also prevents
				// a room from retaining canvasSeeded=true with an empty record map.
				//
				// A valid tldraw document always has document and page records. If an
				// older failed seed left only the marker behind, an empty map is
				// therefore safe to repair from the database snapshot.
				const seeded = store.getStoreSnapshot().store;
				room.doc.transact(() => {
					// Document scope only: session records (instance, camera, user)
					// must never enter the shared map or persisted DB snapshot.
					for (const record of Object.values(seeded)) {
						yRecords.set(record.id, record as TLRecord);
					}
					meta.set("canvasSeeded", true);
				});
			}
		}
		// Persist the schema understood by the current tldraw store, not the
		// possibly older schema from the SQLite seed. Public shares and rollback
		// projections need this to decode records created after a tldraw upgrade.
		const normalizedSchema = store.getStoreSnapshot().schema;
		if (canEdit) {
			room.doc.transact(() => {
				meta.set("schema", normalizedSchema);
				meta.set("canvasSeeded", true);
			});
		}

		// Local document edits → shared map. mergeRemoteChanges applies with
		// source "remote", so remote-applied records never loop back here.
		const unsubscribe = canEdit
			? store.listen(
					({ changes }) => {
						room.doc.transact(() => {
							for (const record of Object.values(changes.added)) {
								yRecords.set(record.id, record);
							}
							for (const [, record] of Object.values(changes.updated)) {
								yRecords.set(record.id, record);
							}
							for (const record of Object.values(changes.removed)) {
								yRecords.delete(record.id);
							}
						});
					},
					{ source: "user", scope: "document" },
				)
			: null;

		// Shared map changes from peers → local store.
		const observer = (event: YMapEvent<TLRecord>, transaction: Transaction) => {
			if (transaction.local) return;
			store.mergeRemoteChanges(() => {
				const toPut: TLRecord[] = [];
				const toRemove: TLRecord["id"][] = [];
				for (const key of event.keysChanged) {
					const value = yRecords.get(key);
					if (value) toPut.push(value);
					else toRemove.push(key as TLRecord["id"]);
				}
				if (toPut.length > 0) store.put(toPut);
				if (toRemove.length > 0) store.remove(toRemove);
			});
		};
		yRecords.observe(observer);

		// --- Presence: remote cursors -----------------------------------
		const awareness = room.provider.awareness;
		const ownClientId = room.doc.clientID;
		// Ids derive from awareness client ids so a departing peer's record
		// can be removed without knowing anything else about them.
		const presenceId = InstancePresenceRecordType.createId(String(ownClientId));
		const presenceDerivation = createPresenceStateDerivation(
			userSignalRef.current,
			{ instanceId: presenceId },
		)(store);
		const stopPresencePush = react("push canvas presence", () => {
			// TLInstancePresence is plain JSON at runtime; the cast bridges
			// tldraw's branded types to Liveblocks' JsonObject.
			awareness.setLocalStateField(
				"tldraw",
				presenceDerivation.get() as unknown as Record<string, never> | null,
			);
		});

		const applyPeerPresence = (update: {
			added: number[];
			updated: number[];
			removed: number[];
		}) => {
			const states = awareness.getStates();
			const toPut: TLInstancePresence[] = [];
			const toRemove: TLInstancePresence["id"][] = [];
			for (const clientId of [...update.added, ...update.updated]) {
				if (clientId === ownClientId) continue;
				const presence = (
					states.get(clientId) as
						| { tldraw?: TLInstancePresence | null }
						| undefined
				)?.tldraw;
				if (presence) toPut.push(presence);
			}
			for (const clientId of update.removed) {
				toRemove.push(InstancePresenceRecordType.createId(String(clientId)));
			}
			if (toPut.length === 0 && toRemove.length === 0) return;
			store.mergeRemoteChanges(() => {
				if (toRemove.length > 0) store.remove(toRemove);
				if (toPut.length > 0) store.put(toPut);
			});
		};
		awareness.on("update", applyPeerPresence);
		// Collaborators who were already here before this client joined.
		applyPeerPresence({
			added: [...awareness.getStates().keys()],
			updated: [],
			removed: [],
		});

		setStoreWithStatus({
			status: "synced-remote",
			connectionStatus: "online",
			store,
		});

		if (process.env.NODE_ENV === "development") {
			// Dev-only handle for inspecting presence flow from the console.
			(
				window as unknown as { __canvasCollabDebug?: unknown }
			).__canvasCollabDebug = { store, awareness, presenceDerivation };
		}

		return () => {
			stopPresencePush();
			awareness.off("update", applyPeerPresence);
			awareness.setLocalStateField("tldraw", null);
			yRecords.unobserve(observer);
			unsubscribe?.();
			setStoreWithStatus({ status: "loading" });
		};
	}, [room, canEdit]);

	return storeWithStatus;
}

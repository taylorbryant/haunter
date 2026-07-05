"use client";

import { useEffect, useRef, useState } from "react";
import {
	createTLStore,
	defaultBindingUtils,
	defaultShapeUtils,
	loadSnapshot,
	type TLRecord,
	type TLStoreSnapshot,
	type TLStoreWithStatus,
} from "tldraw";
import type { Transaction, YMapEvent } from "yjs";
import type { CollabRoom } from "@/features/collab/client/liveblocks";

/**
 * A stored canvas snapshot tldraw can actually load. Legacy/empty rows
 * (e.g. the '{}' column default) lack the schema and crash tldraw's
 * migrator, so they are treated as "no snapshot".
 */
export function isLoadableSnapshot(
	value: Record<string, unknown>,
): value is Record<string, unknown> & TLStoreSnapshot {
	return (
		typeof value.schema === "object" &&
		value.schema !== null &&
		typeof value.store === "object" &&
		value.store !== null
	);
}

/**
 * Two-way binding between a tldraw store and a shared Y.Map of records —
 * every local document change lands in the map, every remote map change
 * lands in the store (via mergeRemoteChanges so it doesn't echo back).
 * tldraw presence (remote cursors) is intentionally not synced yet; this
 * is document collaboration only.
 */
export function useCollabCanvasStore(
	room: CollabRoom,
	snapshot: Record<string, unknown>,
): TLStoreWithStatus {
	const [storeWithStatus, setStoreWithStatus] = useState<TLStoreWithStatus>({
		status: "loading",
	});
	// The DB snapshot is only the seed for a brand-new room; a refetch must
	// not rebuild the store.
	const seedSnapshotRef = useRef(snapshot);

	useEffect(() => {
		const store = createTLStore({
			shapeUtils: defaultShapeUtils,
			bindingUtils: defaultBindingUtils,
		});
		const yRecords = room.doc.getMap<TLRecord>("tldraw");
		const meta = room.doc.getMap<boolean>("haunter-meta");

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
			if (meta.get("canvasSeeded") !== true) {
				room.doc.transact(() => {
					meta.set("canvasSeeded", true);
					for (const record of store.allRecords()) {
						yRecords.set(record.id, record);
					}
				});
			}
		}

		// Local document edits → shared map. mergeRemoteChanges applies with
		// source "remote", so remote-applied records never loop back here.
		const unsubscribe = store.listen(
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
		);

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

		setStoreWithStatus({
			status: "synced-remote",
			connectionStatus: "online",
			store,
		});

		return () => {
			yRecords.unobserve(observer);
			unsubscribe();
			setStoreWithStatus({ status: "loading" });
		};
	}, [room]);

	return storeWithStatus;
}

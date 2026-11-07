import { expect, spyOn, test } from "bun:test";
import {
	createTLStore,
	defaultShapeUtils,
	defaultBindingUtils,
	type TLPage,
	type TLStoreSnapshot,
} from "tldraw";
import { CanvasSyncRecovery } from "../client/sync-recovery";
import { canvasFingerprint, normalizeCanvasSnapshot } from "../lib/document";
import type { LocalDraft } from "@/client/local-drafts";
import type { DurableDraftStorage } from "@/client/durable-drafts";
const pageId = "page:page" as TLPage["id"];
const identity = {
	userId: "one",
	workspaceId: "workspace",
	resourceId: "canvas",
};
function fixture() {
	const rows = new Map<string, LocalDraft<TLStoreSnapshot>>();
	const storage: DurableDraftStorage<TLStoreSnapshot> = {
		load: async (key) => rows.get(key) ?? null,
		persist: async (row) => {
			rows.set(row.key, row);
		},
		discard: async (key) => {
			rows.delete(key);
		},
		acknowledge: async () => null,
	};
	const store = createTLStore({
		shapeUtils: defaultShapeUtils,
		bindingUtils: defaultBindingUtils,
		snapshot: normalizeCanvasSnapshot({}),
	});
	const recovery = new CanvasSyncRecovery(store, identity, storage, () => {});
	return { rows, store, recovery, storage };
}
test("immediate navigation saves the final edit; only matching durable receipts clear its copy", async () => {
	const f = fixture();
	try {
		const before = await canvasFingerprint(f.store.getStoreSnapshot());
		f.store.put([{ ...f.store.get(pageId)!, name: "Last keystroke" }]);
		await f.recovery.flushLocal();
		expect(f.recovery.getSnapshot()).toMatchObject({
			dirty: true,
			locallySaved: true,
		});
		expect(
			f.rows.get(f.recovery.identity.key)?.payload.store[pageId],
		).toMatchObject({ name: "Last keystroke" });
		f.recovery.acknowledge(before);
		await f.recovery.flushLocal();
		expect(f.rows.size).toBe(1);
		f.recovery.acknowledge(await canvasFingerprint(f.store.getStoreSnapshot()));
		await f.recovery.flushLocal();
		expect(f.rows.size).toBe(0);
		expect(f.recovery.getSnapshot().dirty).toBe(false);
	} finally {
		f.recovery.dispose();
	}
});
test("parallel tabs have separate recovery keys and storage failures leave a downloadable live value", async () => {
	const a = fixture(),
		b = fixture();
	try {
		expect(a.recovery.identity.key).not.toBe(b.recovery.identity.key);
		a.storage.persist = async () => {
			throw new Error("quota");
		};
		a.store.put([{ ...a.store.get(pageId)!, name: "Preserved in memory" }]);
		await expect(a.recovery.flushLocal()).rejects.toThrow("quota");
		expect(a.recovery.getSnapshot()).toMatchObject({
			status: "storage-error",
			dirty: true,
			locallySaved: false,
		});
		expect(a.recovery.getSnapshot().value.store[pageId]).toMatchObject({
			name: "Preserved in memory",
		});
	} finally {
		a.recovery.dispose();
		b.recovery.dispose();
	}
});
test("a continuous edit stream serializes the recovery copy at most once per max wait, then once when idle", async () => {
	const rows = new Map<string, LocalDraft<TLStoreSnapshot>>();
	let writes = 0;
	const storage: DurableDraftStorage<TLStoreSnapshot> = {
		load: async (key) => rows.get(key) ?? null,
		persist: async (row) => {
			writes++;
			rows.set(row.key, row);
		},
		discard: async (key) => {
			rows.delete(key);
		},
		acknowledge: async () => null,
	};
	const store = createTLStore({
		shapeUtils: defaultShapeUtils,
		bindingUtils: defaultBindingUtils,
		snapshot: normalizeCanvasSnapshot({}),
	});
	const recovery = new CanvasSyncRecovery(store, identity, storage, () => {}, {
		captureDebounceMs: 50,
		captureMaxWaitMs: 200,
	});
	try {
		// ~400 ms of edits 10 ms apart, like pointer frames during a drag.
		const edits = 40;
		for (let i = 0; i < edits; i++) {
			store.put([{ ...store.get(pageId)!, name: `Drag frame ${i}` }]);
			if (i === 0)
				// The guard sees the edit immediately, before any serialization.
				expect(recovery.getSnapshot()).toMatchObject({
					dirty: true,
					locallySaved: false,
				});
			await new Promise((r) => setTimeout(r, 10));
		}
		const duringDrag = writes;
		expect(duringDrag).toBeGreaterThanOrEqual(1);
		expect(duringDrag).toBeLessThanOrEqual(3);
		// Idle past the debounce: the final frame is captured and persisted.
		await new Promise((r) => setTimeout(r, 150));
		expect(writes).toBeLessThanOrEqual(duringDrag + 1);
		expect(
			rows.get(recovery.identity.key)?.payload.store[pageId],
		).toMatchObject({ name: `Drag frame ${edits - 1}` });
		expect(recovery.getSnapshot()).toMatchObject({
			dirty: true,
			locallySaved: true,
			status: "pending",
		});
	} finally {
		recovery.dispose();
	}
});
test("edits that cancel out inside the capture window stay unsaved until a receipt matches", async () => {
	const f = fixture();
	try {
		const original = f.store.get(pageId)!;
		const fingerprint = await canvasFingerprint(f.store.getStoreSnapshot());
		f.recovery.acknowledge(fingerprint);
		f.store.put([{ ...original, name: "Created" }]);
		f.store.put([original]);
		await f.recovery.flushLocal();
		// The intermediate push may have reached the server; keep a copy of the
		// reverted state until the server confirms it too.
		expect(f.recovery.getSnapshot()).toMatchObject({
			dirty: true,
			locallySaved: true,
		});
		expect(f.rows.size).toBe(1);
		f.recovery.acknowledge(fingerprint);
		await f.recovery.flushLocal();
		expect(f.rows.size).toBe(0);
		expect(f.recovery.getSnapshot().dirty).toBe(false);
	} finally {
		f.recovery.dispose();
	}
});

test("duplicate save receipts capture and discard a changed document only once", async () => {
	const f = fixture();
	let reads: ReturnType<typeof spyOn> | undefined;
	let discards: ReturnType<typeof spyOn> | undefined;
	try {
		f.recovery.acknowledge(await canvasFingerprint(f.store.getStoreSnapshot()));
		f.store.put([{ ...f.store.get(pageId)!, name: "A durable edit" }]);
		const fingerprint = await canvasFingerprint(f.store.getStoreSnapshot());
		reads = spyOn(f.store, "getStoreSnapshot");
		discards = spyOn(f.storage, "discard");
		for (let i = 0; i < 100; i++) f.recovery.acknowledge(fingerprint);
		await f.recovery.flushLocal();
		expect(reads).toHaveBeenCalledTimes(1);
		expect(discards).toHaveBeenCalledTimes(1);
		expect(f.recovery.getSnapshot().dirty).toBe(false);
		expect(f.rows.size).toBe(0);
	} finally {
		reads?.mockRestore();
		discards?.mockRestore();
		f.recovery.dispose();
	}
});

test("an unchanged receipt still captures remote document changes", async () => {
	const f = fixture();
	try {
		const fingerprint = await canvasFingerprint(f.store.getStoreSnapshot());
		f.recovery.acknowledge(fingerprint);
		f.store.mergeRemoteChanges(() =>
			f.store.put([{ ...f.store.get(pageId)!, name: "Remote edit" }]),
		);
		f.recovery.acknowledge(fingerprint);
		await f.recovery.flushLocal();
		expect(
			f.rows.get(f.recovery.identity.key)?.payload.store[pageId],
		).toMatchObject({ name: "Remote edit" });
		f.recovery.acknowledge(await canvasFingerprint(f.store.getStoreSnapshot()));
		await f.recovery.flushLocal();
		expect(f.recovery.getSnapshot().dirty).toBe(false);
		expect(f.rows.size).toBe(0);
	} finally {
		f.recovery.dispose();
	}
});

test("a fresh matching receipt before the capture timer clears the recovery copy", async () => {
	const f = fixture();
	try {
		f.recovery.acknowledge(await canvasFingerprint(f.store.getStoreSnapshot()));
		f.store.put([{ ...f.store.get(pageId)!, name: "Freshly saved" }]);
		const fingerprint = await canvasFingerprint(f.store.getStoreSnapshot());
		f.recovery.acknowledge(fingerprint);
		await f.recovery.flushLocal();
		expect(f.recovery.getSnapshot().dirty).toBe(false);
		expect(f.rows.size).toBe(0);
	} finally {
		f.recovery.dispose();
	}
});

test("an in-flight acknowledgement cannot discard a newer edit followed by undo", async () => {
	const f = fixture();
	const entered = Promise.withResolvers<void>();
	const released = Promise.withResolvers<void>();
	const discard = f.storage.discard;
	f.storage.discard = async (key) => {
		entered.resolve();
		await released.promise;
		await discard(key);
	};
	try {
		f.store.put([{ ...f.store.get(pageId)!, name: "Committed" }]);
		const fingerprint = await canvasFingerprint(f.store.getStoreSnapshot());
		f.recovery.acknowledge(fingerprint);
		await entered.promise;
		const original = f.store.get(pageId)!;
		f.store.put([{ ...original, name: "Intermediate edit" }]);
		f.store.put([original]);
		const flushed = f.recovery.flushLocal();
		released.resolve();
		await flushed;
		expect(f.recovery.getSnapshot().dirty).toBe(true);
		expect(
			f.rows.get(f.recovery.identity.key)?.payload.store[pageId],
		).toMatchObject({ name: "Committed" });
		f.recovery.acknowledge(fingerprint);
		await f.recovery.flushLocal();
		expect(f.recovery.getSnapshot().dirty).toBe(false);
		expect(f.rows.size).toBe(0);
	} finally {
		released.resolve();
		f.recovery.dispose();
	}
});

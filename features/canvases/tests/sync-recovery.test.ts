import { expect, test } from "bun:test";
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

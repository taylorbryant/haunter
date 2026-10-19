import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import Dexie from "dexie";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import * as Y from "yjs";
import {
	LocalDocumentStore,
	listDocumentRecoveryCopies,
	dismissDocumentRecoveryCopies,
	saveDocumentReceipt,
	advanceDocumentGeneration,
	loadDocumentHead,
	readDocumentRecovery,
} from "../client/local-store";

import { createPersistenceReceipt } from "../receipt";

const original = { ...Dexie.dependencies };
beforeAll(() => {
	Dexie.dependencies.indexedDB = indexedDB;
	Dexie.dependencies.IDBKeyRange = IDBKeyRange;
});
afterAll(() => {
	Object.assign(Dexie.dependencies, original);
});

describe("local collaborative persistence", () => {
	test("dismissal retains recovery data and late dismissals cannot hide new copies", async () => {
		const key = crypto.randomUUID();
		const doc = new Y.Doc();
		doc.getText("draft").insert(0, "Keep these edits");
		try {
			await advanceDocumentGeneration(key, 0, 1, Y.encodeStateAsUpdate(doc));
			const before = await readDocumentRecovery(key, 0);
			const copies = await listDocumentRecoveryCopies(key);
			await dismissDocumentRecoveryCopies(key, copies);
			expect((await listDocumentRecoveryCopies(key))[0]!.dismissed).toBe(true);
			expect(await readDocumentRecovery(key, 0)).toEqual(before);
			await advanceDocumentGeneration(key, 1, 2, Y.encodeStateAsUpdate(doc));
			await dismissDocumentRecoveryCopies(key, copies);
			const head = await loadDocumentHead(key);
			expect(head.generation).toBe(2);
			expect(head.recoveries).toEqual([1, 0]);
			expect(
				(await listDocumentRecoveryCopies(key)).map((copy) => copy.dismissed),
			).toEqual([false, true]);
		} finally {
			doc.destroy();
		}
	});
	test("flush survives reload, including deletion-only changes", async () => {
		const key = crypto.randomUUID();
		const doc = new Y.Doc();
		let locallySaved = true;
		const local = new LocalDocumentStore(key, doc, (saved) => {
			locallySaved = saved;
		});
		await local.load();
		doc.getText("text").insert(0, "abc");
		expect(locallySaved).toBe(false);
		await local.flush();
		expect(locallySaved).toBe(true);
		doc.getText("text").delete(1, 1);
		await local.flush();
		local.destroy();
		doc.destroy();
		const restored = new Y.Doc();
		const next = new LocalDocumentStore(key, restored, () => {});
		await next.load();
		expect(restored.getText("text").toString()).toBe("ac");
		next.destroy();
		restored.destroy();
	});
	test("compaction preserves concurrent tab updates and isolates account cache keys", async () => {
		const key = crypto.randomUUID();
		const left = new Y.Doc(),
			right = new Y.Doc();
		const a = new LocalDocumentStore(key, left, () => {}),
			b = new LocalDocumentStore(key, right, () => {});
		await Promise.all([a.load(), b.load()]);
		for (let i = 0; i < 150; i++) {
			left.getText("left").insert(i, "a");
			right.getText("right").insert(i, "b");
		}
		await Promise.all([a.flush(), b.flush()]);
		const restored = new Y.Doc(),
			other = new Y.Doc();
		const c = new LocalDocumentStore(key, restored, () => {}),
			isolated = new LocalDocumentStore(`${key}-other-user`, other, () => {});
		await Promise.all([c.load(), isolated.load()]);
		expect(restored.getText("left").length).toBe(150);
		expect(restored.getText("right").length).toBe(150);
		expect(other.getText("left").length).toBe(0);
		for (const store of [a, b, c, isolated]) store.destroy();
		for (const doc of [left, right, restored, other]) doc.destroy();
	});
});

test("recovery history distinguishes saved, unsynced, and legacy copies and keeps dismissal scoped to the reviewed content", async () => {
	const key = crypto.randomUUID();
	const cache: import("../client/local-store").RecoveryReadCache = new Map();
	const doc = new Y.Doc();
	doc.getText("draft").insert(0, "Saved text");
	const receipt = { ...createPersistenceReceipt(doc), revision: 2 };
	await saveDocumentReceipt(key, 0, receipt);
	await advanceDocumentGeneration(key, 0, 1, Y.encodeStateAsUpdate(doc));
	let copies = await listDocumentRecoveryCopies(key, cache);
	expect(copies[0]!.syncStatus).toBe("saved");
	expect(copies[0]!.archivedAt).not.toBeNull();
	const archivedAt = copies[0]!.archivedAt;
	// A receipt for the new current generation must not decode unchanged archives again.
	await saveDocumentReceipt(key, 1, receipt);
	expect((await listDocumentRecoveryCopies(key, cache))[0]).toBe(copies[0]);
	// A late, old acknowledgement can't supersede the newer receipt.
	await saveDocumentReceipt(key, 0, {
		...createPersistenceReceipt(new Y.Doc()),
		revision: 1,
	});
	expect((await listDocumentRecoveryCopies(key, cache))[0]!.syncStatus).toBe(
		"saved",
	);
	// An offline tab contributes a delete-only edit after another tab's restore.
	doc.getText("draft").delete(0, 1);
	await advanceDocumentGeneration(key, 0, 1, Y.encodeStateAsUpdate(doc));
	copies = await listDocumentRecoveryCopies(key, cache);
	expect(copies[0]!.syncStatus).toBe("unsynced");
	expect(copies[0]!.archivedAt).toBe(archivedAt);
	await dismissDocumentRecoveryCopies(key, copies);
	expect((await listDocumentRecoveryCopies(key, cache))[0]!.dismissed).toBe(
		true,
	);
	expect(await readDocumentRecovery(key, 0)).toEqual(copies[0]!.update);
	// Same generation, more late edits: show the notice again without losing dismissal history.
	doc.getText("draft").insert(0, "Late edit ");
	await advanceDocumentGeneration(key, 0, 1, Y.encodeStateAsUpdate(doc));
	expect((await listDocumentRecoveryCopies(key, cache))[0]!.dismissed).toBe(
		false,
	);
	// A dismissal that finishes late still covers only what the user actually saw.
	await dismissDocumentRecoveryCopies(key, copies);
	expect((await listDocumentRecoveryCopies(key, cache))[0]!.dismissed).toBe(
		false,
	);
	await advanceDocumentGeneration(key, 2, 3, Y.encodeStateAsUpdate(doc));
	expect((await listDocumentRecoveryCopies(key, cache))[0]!.syncStatus).toBe(
		"unknown",
	);
	expect(await listDocumentRecoveryCopies(`${key}-other-user`)).toEqual([]);
	doc.destroy();
});

test("pre-metadata archives remain readable without invented timestamps or sync claims", async () => {
	const key = crypto.randomUUID();
	const doc = new Y.Doc();
	doc.getText("draft").insert(0, "Legacy draft");
	await advanceDocumentGeneration(key, 0, 1, Y.encodeStateAsUpdate(doc));
	const legacy = new Dexie("haunter-yjs-documents-v1");
	try {
		await legacy.open();
		await legacy.table("heads").put({ key, generation: 1, recoveries: [0] });
		const [copy] = await listDocumentRecoveryCopies(key);
		expect(copy).toMatchObject({
			generation: 0,
			archivedAt: null,
			syncStatus: "unknown",
			dismissed: false,
		});
		// An older tab may discover the restore much later. That is not the archive date.
		doc.getText("draft").insert(0, "Late edit ");
		await advanceDocumentGeneration(key, 0, 1, Y.encodeStateAsUpdate(doc));
		expect((await listDocumentRecoveryCopies(key))[0]).toMatchObject({
			archivedAt: null,
			syncStatus: "unknown",
		});
	} finally {
		legacy.close();
		doc.destroy();
	}
});

test("legacy dismissals require review once and then detect late inserts and deletions from an old tab", async () => {
	const key = crypto.randomUUID();
	const cache: import("../client/local-store").RecoveryReadCache = new Map();
	const doc = new Y.Doc();
	doc.getText("draft").insert(0, "Legacy draft");
	await advanceDocumentGeneration(key, 0, 1, Y.encodeStateAsUpdate(doc));
	const legacy = new Dexie("haunter-yjs-documents-v1");
	const oldTab = new LocalDocumentStore(key, doc, () => {});
	try {
		await legacy.open();
		await legacy.table("heads").put({
			key,
			generation: 1,
			recoveries: [0],
			dismissedRecoveryThrough: 0,
		});
		let copies = await listDocumentRecoveryCopies(key, cache);
		expect(copies[0]!.dismissed).toBe(false);
		await dismissDocumentRecoveryCopies(key, copies);
		// A fresh read, without the cache, honors the new content-based dismissal.
		expect((await listDocumentRecoveryCopies(key))[0]!.dismissed).toBe(true);
		expect(await readDocumentRecovery(key, 0)).toEqual(copies[0]!.update);
		await oldTab.load();
		doc.getText("draft").delete(0, 1);
		await oldTab.flush();
		copies = await listDocumentRecoveryCopies(key, cache);
		expect(copies[0]!.dismissed).toBe(false);
		await dismissDocumentRecoveryCopies(key, copies);
		expect((await listDocumentRecoveryCopies(key, cache))[0]!.dismissed).toBe(
			true,
		);
		doc.getText("draft").insert(0, "Late edit ");
		await oldTab.flush();
		expect((await listDocumentRecoveryCopies(key, cache))[0]!.dismissed).toBe(
			false,
		);
		await advanceDocumentGeneration(key, 0, 1, Y.encodeStateAsUpdate(doc));
		expect((await listDocumentRecoveryCopies(key, cache))[0]).toMatchObject({
			dismissed: false,
			archivedAt: null,
			syncStatus: "unknown",
		});
		const recovered = new Y.Doc();
		try {
			Y.applyUpdate(recovered, (await readDocumentRecovery(key, 0))!);
			expect(recovered.getText("draft").toString()).toBe(
				"Late edit egacy draft",
			);
		} finally {
			recovered.destroy();
		}
	} finally {
		oldTab.destroy();
		legacy.close();
		doc.destroy();
	}
});

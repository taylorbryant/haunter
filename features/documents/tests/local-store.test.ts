import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import Dexie from "dexie";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import * as Y from "yjs";
import { LocalDocumentStore } from "../client/local-store";

const original = { ...Dexie.dependencies };
beforeAll(() => {
	Dexie.dependencies.indexedDB = indexedDB;
	Dexie.dependencies.IDBKeyRange = IDBKeyRange;
});
afterAll(() => {
	Object.assign(Dexie.dependencies, original);
});

describe("local collaborative persistence", () => {
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

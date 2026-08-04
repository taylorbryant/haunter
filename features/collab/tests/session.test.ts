import { describe, expect, it } from "bun:test";
import * as Y from "yjs";
import {
	type CollabRoom,
	isCollabRoomReady,
	waitForCollabPersistence,
} from "@/features/collab/client/session";

class FakeProvider {
	private status: "loading" | "synchronizing" | "synchronized";
	private listeners = new Set<() => void>();

	constructor(status: "loading" | "synchronizing" | "synchronized") {
		this.status = status;
	}

	getStatus() {
		return this.status;
	}

	on(event: string, listener: () => void) {
		if (event === "status") this.listeners.add(listener);
	}

	off(event: string, listener: () => void) {
		if (event === "status") this.listeners.delete(listener);
	}

	setStatus(status: "loading" | "synchronizing" | "synchronized") {
		this.status = status;
		for (const listener of this.listeners) listener();
	}
}

function roomWith(provider: FakeProvider): CollabRoom {
	return {
		doc: new Y.Doc(),
		provider: provider as unknown as CollabRoom["provider"],
		synced: true,
		localReady: false,
	};
}

describe("collaboration readiness", () => {
	it("mounts from either a valid local document or remote synchronization", () => {
		const provider = new FakeProvider("loading");
		const room = roomWith(provider);
		expect(isCollabRoomReady({ ...room, synced: false })).toBe(false);
		expect(
			isCollabRoomReady({ ...room, synced: false, localReady: true }),
		).toBe(true);
		expect(isCollabRoomReady({ ...room, synced: true })).toBe(true);
		room.doc.destroy();
	});
});

describe("collaboration persistence", () => {
	it("waits for a local quiet period and provider acknowledgement", async () => {
		const provider = new FakeProvider("synchronized");
		const room = roomWith(provider);
		const startedAt = Date.now();
		const persisted = waitForCollabPersistence(room, 1000);
		room.doc.getMap("test").set("value", 1);
		provider.setStatus("synchronizing");
		setTimeout(() => provider.setStatus("synchronized"), 20);

		expect(await persisted).toBe(true);
		expect(Date.now() - startedAt).toBeGreaterThanOrEqual(200);
		room.doc.destroy();
	});

	it("fails when the provider never acknowledges the document", async () => {
		const provider = new FakeProvider("synchronizing");
		const room = roomWith(provider);
		expect(await waitForCollabPersistence(room, 20)).toBe(false);
		room.doc.destroy();
	});

	it("does not treat collaborator updates as new local unsaved work", async () => {
		const provider = new FakeProvider("synchronized");
		const room = roomWith(provider);
		const persisted = waitForCollabPersistence(room, 300);
		setTimeout(() => {
			room.doc.transact(() => {
				room.doc.getMap("remote").set("first", 1);
			}, "backend");
		}, 100);
		setTimeout(() => {
			room.doc.transact(() => {
				room.doc.getMap("remote").set("second", 2);
			}, "backend");
		}, 200);

		expect(await persisted).toBe(true);
		room.doc.destroy();
	});
});

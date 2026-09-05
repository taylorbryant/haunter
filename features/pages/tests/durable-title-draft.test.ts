import { describe, expect, test } from "bun:test";
import {
	DurableDraftController,
	type DurableDraftSnapshot,
	type DurableDraftStorage,
} from "@/client/durable-drafts";
import type { LocalDraft } from "@/client/local-drafts";

const identity = {
	key: JSON.stringify(["user_1", "page-title", "page_1"]),
	userId: "user_1",
	workspaceId: "workspace_1",
	resourceType: "page-title" as const,
	resourceId: "page_1",
};

function createMemoryStorage<T = string>(initial: LocalDraft<T> | null = null) {
	let stored = initial;
	let rejectWrites = false;
	let rejectDiscards = false;
	const writes: LocalDraft<T>[] = [];
	const storage: DurableDraftStorage<T> = {
		load: async () => stored,
		persist: async (draft) => {
			if (rejectWrites) throw new Error("IndexedDB unavailable");
			stored = draft;
			writes.push(draft);
		},
		discard: async () => {
			if (rejectDiscards) throw new Error("IndexedDB delete failed");
			stored = null;
		},
		acknowledge: async (_key, savedWriteId, serverVersion) => {
			if (!stored) return null;
			if (stored.writeId === savedWriteId) {
				stored = null;
				return null;
			}
			stored = { ...stored, baseVersion: serverVersion, status: "unsaved" };
			return stored;
		},
	};
	return {
		storage,
		writes,
		get stored() {
			return stored;
		},
		set rejectWrites(value: boolean) {
			rejectWrites = value;
		},
		set rejectDiscards(value: boolean) {
			rejectDiscards = value;
		},
	};
}

function waitForDraft<T>(
	controller: DurableDraftController<T>,
	predicate: (snapshot: DurableDraftSnapshot<T>) => boolean,
) {
	const current = controller.getSnapshot();
	if (predicate(current)) return Promise.resolve(current);
	return new Promise<DurableDraftSnapshot<T>>((resolve, reject) => {
		const timeout = setTimeout(() => {
			unsubscribe();
			reject(
				new Error(
					`Timed out waiting for draft state; current=${controller.getSnapshot().status}`,
				),
			);
		}, 1_000);
		const unsubscribe = controller.subscribe(() => {
			const snapshot = controller.getSnapshot();
			if (!predicate(snapshot)) return;
			clearTimeout(timeout);
			unsubscribe();
			resolve(snapshot);
		});
	});
}

function createTitleController(
	storage: DurableDraftStorage<string>,
	overrides: Partial<
		ConstructorParameters<typeof DurableDraftController<string>>[0]
	> = {},
) {
	return new DurableDraftController<string>({
		identity,
		serverValue: "Server title",
		serverVersion: "v1",
		storage,
		debounceMs: 0,
		isPayload: (value): value is string => typeof value === "string",
		saveServer: async ({ value }) => ({ value, version: "v2" }),
		...overrides,
	});
}

describe("durable title draft actor", () => {
	test("persists locally before attempting the server save", async () => {
		const memory = createMemoryStorage();
		let durableAtServerCall: LocalDraft<string> | null = null;
		const controller = createTitleController(memory.storage, {
			saveServer: async ({ value }) => {
				durableAtServerCall = memory.stored;
				return { value, version: "v2" };
			},
		});
		controller.start();
		await waitForDraft(controller, (draft) => draft.status === "saved");

		controller.edit("Local first");
		await waitForDraft(
			controller,
			(draft) => draft.status === "saved" && draft.value === "Local first",
		);

		expect(durableAtServerCall).toMatchObject({
			payload: "Local first",
			status: "unsaved",
			revision: 1,
		});
		expect(memory.stored).toBeNull();
		controller.stop();
	});

	test("keeps a failed server save recoverable and retries it", async () => {
		const memory = createMemoryStorage();
		let offline = true;
		const controller = createTitleController(memory.storage, {
			saveServer: async ({ value }) => {
				if (offline) throw new Error("offline");
				return { value, version: "v2" };
			},
		});
		controller.start();
		await waitForDraft(controller, (draft) => draft.status === "saved");

		controller.edit("Keep this sentence");
		await waitForDraft(controller, (draft) => draft.status === "sync-error");
		expect(memory.stored).toMatchObject({
			payload: "Keep this sentence",
			status: "unsaved",
		});

		offline = false;
		controller.retry();
		await waitForDraft(controller, (draft) => draft.status === "saved");
		expect(memory.stored).toBeNull();
		controller.stop();
	});

	test("resumes a same-version draft after remount", async () => {
		const memory = createMemoryStorage({
			...identity,
			baseVersion: "v1",
			payload: "Recovered title",
			status: "unsaved",
			updatedAt: "2026-09-04T00:00:00.000Z",
			revision: 7,
		});
		const saves: string[] = [];
		const controller = createTitleController(memory.storage, {
			saveServer: async ({ value }) => {
				saves.push(value);
				return { value, version: "v2" };
			},
		});
		controller.start();

		await waitForDraft(controller, (draft) => draft.status === "saved");
		expect(saves).toEqual(["Recovered title"]);
		expect(controller.getSnapshot().value).toBe("Recovered title");
		expect(memory.stored).toBeNull();
		controller.stop();
	});

	test("surfaces a stale recovery as a conflict until the user chooses", async () => {
		const memory = createMemoryStorage({
			...identity,
			baseVersion: "old-version",
			payload: "Recovered title",
			status: "unsaved",
			updatedAt: "2026-09-04T00:00:00.000Z",
			revision: 3,
		});
		const saves: string[] = [];
		const controller = createTitleController(memory.storage, {
			saveServer: async ({ value }) => {
				saves.push(value);
				return { value, version: "v2" };
			},
		});
		controller.start();

		await waitForDraft(controller, (draft) => draft.status === "conflict");
		expect(controller.getSnapshot()).toMatchObject({
			value: "Recovered title",
			serverValue: "Server title",
		});
		expect(saves).toEqual([]);

		controller.keepMine();
		await waitForDraft(controller, (draft) => draft.status === "saved");
		expect(saves).toEqual(["Recovered title"]);
		controller.stop();
	});

	test("discards a recovery row when the server already has its value", async () => {
		const memory = createMemoryStorage({
			...identity,
			baseVersion: "v1",
			payload: "Server title",
			status: "unsaved",
			updatedAt: "2026-09-04T00:00:00.000Z",
			revision: 4,
			writeId: "accepted-before-unmount",
		});
		let serverCalls = 0;
		const controller = createTitleController(memory.storage, {
			areValuesEqual: (left, right) => left === right,
			saveServer: async ({ value }) => {
				serverCalls += 1;
				return { value, version: "v2" };
			},
		});
		controller.start();

		await waitForDraft(controller, (draft) => draft.status === "saved");
		expect(serverCalls).toBe(0);
		expect(memory.stored).toBeNull();
		controller.stop();
	});

	test("rebases a newer edit behind an in-flight save", async () => {
		const memory = createMemoryStorage();
		let releaseFirst = (_result: { value: string; version: string }) => {};
		const firstSave = new Promise<{ value: string; version: string }>(
			(resolve) => {
				releaseFirst = resolve;
			},
		);
		const calls: Array<{ value: string; baseVersion: string | null }> = [];
		const controller = createTitleController(memory.storage, {
			saveServer: async (input) => {
				calls.push(input);
				if (calls.length === 1) return firstSave;
				return { value: input.value, version: "v3" };
			},
		});
		controller.start();
		await waitForDraft(controller, (draft) => draft.status === "saved");

		controller.edit("First edit");
		await waitForDraft(controller, (draft) => draft.status === "syncing");
		controller.edit("Second edit");
		await controller.flushLocal();
		expect(memory.stored).toMatchObject({
			payload: "Second edit",
			revision: 2,
		});

		releaseFirst({ value: "First edit", version: "v2" });
		await waitForDraft(
			controller,
			(draft) => draft.status === "saved" && draft.value === "Second edit",
		);
		expect(calls).toEqual([
			{ value: "First edit", baseVersion: "v1" },
			{ value: "Second edit", baseVersion: "v2" },
		]);
		expect(memory.stored).toBeNull();
		controller.stop();
	});

	test("orders a server refresh after an accepted in-flight save", async () => {
		const memory = createMemoryStorage();
		let releaseSave = (_result: { value: string; version: string }) => {};
		const save = new Promise<{ value: string; version: string }>((resolve) => {
			releaseSave = resolve;
		});
		let acceptedSaves = 0;
		const controller = createTitleController(memory.storage, {
			saveServer: () => save,
			onServerSaved: () => {
				acceptedSaves += 1;
			},
		});
		controller.start();
		await waitForDraft(controller, (draft) => draft.status === "saved");

		controller.edit("My local title");
		await waitForDraft(controller, (draft) => draft.status === "syncing");
		controller.refreshServer("Another member's title", "v-other");
		releaseSave({ value: "My local title", version: "v2" });
		await waitForDraft(
			controller,
			(draft) => draft.status === "saved" && draft.serverVersion === "v-other",
		);

		expect(memory.stored).toBeNull();
		expect(controller.getSnapshot()).toMatchObject({
			status: "saved",
			value: "Another member's title",
			serverValue: "Another member's title",
		});
		expect(acceptedSaves).toBe(1);
		controller.stop();
	});

	test("turns a server compare-and-set rejection into a conflict", async () => {
		const memory = createMemoryStorage();
		const staleWrite = { status: 409 };
		const controller = createTitleController(memory.storage, {
			isConflictError: (error) => error === staleWrite,
			loadServer: async () => ({
				value: "Another member's title",
				version: "v2",
			}),
			saveServer: async () => {
				throw staleWrite;
			},
		});
		controller.start();
		await waitForDraft(controller, (draft) => draft.status === "saved");

		controller.edit("My title");
		await waitForDraft(controller, (draft) => draft.status === "conflict");

		expect(controller.getSnapshot()).toMatchObject({
			value: "My title",
			serverValue: "Another member's title",
			serverVersion: "v2",
		});
		expect(memory.stored).toMatchObject({ payload: "My title" });
		controller.stop();
	});

	test("accepts a compare-and-set rejection when the server has the same value", async () => {
		const memory = createMemoryStorage();
		const staleWrite = { status: 409 };
		const controller = createTitleController(memory.storage, {
			areValuesEqual: (left, right) => left === right,
			isConflictError: (error) => error === staleWrite,
			loadServer: async () => ({ value: "My title", version: "v2" }),
			saveServer: async () => {
				throw staleWrite;
			},
		});
		controller.start();
		await waitForDraft(controller, (draft) => draft.status === "saved");

		controller.edit("My title");
		await waitForDraft(
			controller,
			(draft) => draft.status === "saved" && draft.serverVersion === "v2",
		);

		expect(memory.stored).toBeNull();
		controller.stop();
	});

	test("does not surface a conflict when an unmounted editor saved the restored value", async () => {
		const memory = createMemoryStorage({
			...identity,
			baseVersion: "v1",
			payload: "Saved while navigating",
			status: "unsaved",
			updatedAt: "2026-09-04T00:00:00.000Z",
			revision: 2,
			writeId: "navigation-write",
		});
		const staleWrite = { status: 409 };
		const observedStatuses: string[] = [];
		const controller = createTitleController(memory.storage, {
			debounceMs: 20,
			isConflictError: (error) => error === staleWrite,
			loadServer: async () => ({
				value: "Saved while navigating",
				version: "v2",
			}),
			saveServer: async () => {
				throw staleWrite;
			},
		});
		controller.subscribe(() => {
			observedStatuses.push(controller.getSnapshot().status);
		});
		controller.start();
		await waitForDraft(controller, (draft) => draft.status === "pending");

		// The first editor's completed save refreshes the remounted editor.
		controller.refreshServer("Saved while navigating", "v2");

		await waitForDraft(
			controller,
			(draft) => draft.status === "saved" && draft.serverVersion === "v2",
		);
		expect(observedStatuses).not.toContain("conflict");
		expect(memory.stored).toBeNull();
		controller.stop();
	});

	test("keeps the conflict visible when the server-copy choice cannot be stored", async () => {
		const memory = createMemoryStorage({
			...identity,
			baseVersion: "v0",
			payload: "Recovered title",
			status: "unsaved",
			updatedAt: "2026-09-04T00:00:00.000Z",
			revision: 1,
			writeId: "recovered-write",
		});
		memory.rejectDiscards = true;
		const controller = createTitleController(memory.storage);
		controller.start();
		await waitForDraft(controller, (draft) => draft.status === "conflict");

		await expect(controller.useServer()).resolves.toBe(false);
		expect(controller.getSnapshot()).toMatchObject({
			status: "conflict",
			value: "Recovered title",
			error: expect.any(Error),
		});
		expect(memory.stored).not.toBeNull();
		controller.stop();
	});

	test("commits and clears a coalesced conflict edit before using the server", async () => {
		const memory = createMemoryStorage({
			...identity,
			baseVersion: "v0",
			payload: "Recovered title",
			status: "unsaved",
			updatedAt: "2026-09-04T00:00:00.000Z",
			revision: 1,
			writeId: "recovered-write",
		});
		let serverCalls = 0;
		const controller = createTitleController(memory.storage, {
			localDebounceMs: 50,
			saveServer: async ({ value }) => {
				serverCalls += 1;
				return { value, version: "v2" };
			},
		});
		controller.start();
		await waitForDraft(controller, (draft) => draft.status === "conflict");

		controller.edit("Newest local conflict edit");
		await expect(controller.useServer()).resolves.toBe(true);
		await new Promise((resolve) => setTimeout(resolve, 60));

		expect(controller.getSnapshot()).toMatchObject({
			status: "saved",
			value: "Server title",
		});
		expect(memory.stored).toBeNull();
		expect(serverCalls).toBe(0);
		controller.stop();
	});

	test("does not clear recovery when a pending conflict edit cannot be stored", async () => {
		const memory = createMemoryStorage({
			...identity,
			baseVersion: "v0",
			payload: "Recovered title",
			status: "unsaved",
			updatedAt: "2026-09-04T00:00:00.000Z",
			revision: 1,
			writeId: "recovered-write",
		});
		const controller = createTitleController(memory.storage, {
			localDebounceMs: 50,
		});
		controller.start();
		await waitForDraft(controller, (draft) => draft.status === "conflict");
		memory.rejectWrites = true;

		controller.edit("Cannot persist this choice");
		await expect(controller.useServer()).resolves.toBe(false);

		expect(controller.getSnapshot()).toMatchObject({
			status: "conflict",
			value: "Cannot persist this choice",
			error: expect.any(Error),
		});
		expect(memory.stored).toMatchObject({ payload: "Recovered title" });
		controller.stop();
	});

	test("does not contact the server when durable storage fails", async () => {
		const memory = createMemoryStorage();
		memory.rejectWrites = true;
		let serverCalls = 0;
		const controller = createTitleController(memory.storage, {
			saveServer: async ({ value }) => {
				serverCalls += 1;
				return { value, version: "v2" };
			},
		});
		controller.start();
		await waitForDraft(controller, (draft) => draft.status === "saved");

		controller.edit("Cannot lose this");
		await waitForDraft(controller, (draft) => draft.status === "storage-error");
		expect(serverCalls).toBe(0);
		controller.stop();
	});

	test("keeps an accepted-but-aborted write recoverable without cache effects", async () => {
		const memory = createMemoryStorage();
		let releaseSave = (_result: { value: string; version: string }) => {};
		const save = new Promise<{ value: string; version: string }>((resolve) => {
			releaseSave = resolve;
		});
		let acceptedSaves = 0;
		const controller = createTitleController(memory.storage, {
			saveServer: () => save,
			onServerSaved: () => {
				acceptedSaves += 1;
			},
		});
		controller.start();
		await waitForDraft(controller, (draft) => draft.status === "saved");

		controller.edit("Recover after unmount");
		await waitForDraft(controller, (draft) => draft.status === "syncing");
		controller.stop();
		releaseSave({ value: "Recover after unmount", version: "v2" });
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(acceptedSaves).toBe(0);
		expect(memory.stored).toMatchObject({
			payload: "Recover after unmount",
			status: "unsaved",
		});
	});

	test("coalesces large structured edits while preserving the latest value", async () => {
		type Document = { blocks: Array<{ id: string; text: string }> };
		const memory = createMemoryStorage<Document>();
		const saves: Document[] = [];
		const controller = new DurableDraftController<Document>({
			identity: { ...identity, resourceType: "page", resourceId: "page_1" },
			serverValue: { blocks: [] },
			serverVersion: "v1",
			storage: memory.storage,
			localDebounceMs: 20,
			debounceMs: 0,
			isPayload: (value): value is Document =>
				typeof value === "object" && value !== null && "blocks" in value,
			saveServer: async ({ value }) => {
				saves.push(value);
				return { value, version: "v2" };
			},
		});
		controller.start();
		await waitForDraft(controller, (draft) => draft.status === "saved");

		controller.edit({ blocks: [{ id: "one", text: "First" }] });
		controller.edit({ blocks: [{ id: "one", text: "Second" }] });
		controller.edit({ blocks: [{ id: "one", text: "Latest" }] });
		await waitForDraft(
			controller,
			(draft) =>
				draft.status === "saved" && draft.value.blocks[0]?.text === "Latest",
		);

		expect(memory.writes).toHaveLength(1);
		expect(saves).toEqual([{ blocks: [{ id: "one", text: "Latest" }] }]);
		controller.stop();
	});
});

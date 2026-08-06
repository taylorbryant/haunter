import { describe, expect, it } from "bun:test";
import {
	createLocalDraftStore,
	type LocalDraft,
	type LocalDraftBackend,
	localDraftKey,
} from "@/client/local-drafts";

function createMemoryBackend(): LocalDraftBackend {
	const values = new Map<string, LocalDraft<unknown>>();
	return {
		get: async <T>(key: string) =>
			(values.get(key) as LocalDraft<T> | undefined) ?? null,
		put: async <T>(draft: LocalDraft<T>) => {
			values.set(draft.key, draft as LocalDraft<unknown>);
		},
		delete: async (key: string) => {
			values.delete(key);
		},
	};
}

function createMemoryHints() {
	const values = new Set<string>();
	return {
		has: (key: string) => values.has(key),
		set: (key: string) => values.add(key),
		delete: (key: string) => values.delete(key),
	};
}

describe("local recovery drafts", () => {
	it("isolates durable drafts by account and resource type", () => {
		expect(localDraftKey("user_1", "page", "resource_1")).not.toBe(
			localDraftKey("user_2", "page", "resource_1"),
		);
		expect(localDraftKey("user_1", "page", "resource_1")).not.toBe(
			localDraftKey("user_1", "canvas", "resource_1"),
		);
	});

	it("recovers a conflict after the store instance is recreated", async () => {
		const backend = createMemoryBackend();
		const hints = createMemoryHints();
		const key = localDraftKey("user_1", "page", "page_1");
		const first = createLocalDraftStore(backend, hints);
		await first.put({
			key,
			userId: "user_1",
			workspaceId: "workspace_1",
			resourceType: "page",
			resourceId: "page_1",
			baseVersion: "v1",
			payload: [{ id: "block_1", text: "Unsaved" }],
			status: "conflict",
			updatedAt: "2026-08-06T12:00:00.000Z",
		});

		const afterReload = createLocalDraftStore(backend, hints);
		expect(afterReload.hasHint(key)).toBe(true);
		expect(await afterReload.get(key)).toMatchObject({
			key,
			status: "conflict",
			payload: [{ id: "block_1", text: "Unsaved" }],
		});
	});

	it("serializes deletion behind an in-flight write", async () => {
		const hints = createMemoryHints();
		const values = new Map<string, LocalDraft<unknown>>();
		let releaseWrite = () => {};
		const writeGate = new Promise<void>((resolve) => {
			releaseWrite = resolve;
		});
		const backend: LocalDraftBackend = {
			get: async <T>(key: string) =>
				(values.get(key) as LocalDraft<T> | undefined) ?? null,
			put: async <T>(draft: LocalDraft<T>) => {
				await writeGate;
				values.set(draft.key, draft as LocalDraft<unknown>);
			},
			delete: async (key: string) => {
				values.delete(key);
			},
		};
		const store = createLocalDraftStore(backend, hints);
		const key = localDraftKey("user_1", "canvas", "canvas_1");
		const write = store.put({
			key,
			userId: "user_1",
			workspaceId: "workspace_1",
			resourceType: "canvas",
			resourceId: "canvas_1",
			baseVersion: "v1",
			payload: { version: 1 },
			status: "conflict",
			updatedAt: "2026-08-06T12:00:00.000Z",
		});
		const deletion = store.delete(key);
		releaseWrite();
		await Promise.all([write, deletion]);

		expect(await store.get(key)).toBeNull();
		expect(store.hasHint(key)).toBe(false);
	});

	it("hides a resolved draft even when IndexedDB deletion fails", async () => {
		const hints = createMemoryHints();
		const backend = createMemoryBackend();
		backend.delete = async () => {
			throw new Error("storage unavailable");
		};
		const store = createLocalDraftStore(backend, hints);
		const key = localDraftKey("user_1", "page", "page_1");
		await store.put({
			key,
			userId: "user_1",
			workspaceId: "workspace_1",
			resourceType: "page",
			resourceId: "page_1",
			baseVersion: "v1",
			payload: [],
			status: "conflict",
			updatedAt: "2026-08-06T12:00:00.000Z",
		});

		expect(store.hasHint(key)).toBe(true);
		expect(store.delete(key)).rejects.toThrow("storage unavailable");
		expect(store.hasHint(key)).toBe(false);
	});
});

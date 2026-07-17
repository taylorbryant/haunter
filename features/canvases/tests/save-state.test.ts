import { describe, expect, it } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
	getCanvasQueryOptions,
	setCanvasSnapshotInCache,
} from "@/features/canvases/client/queries";
import {
	clearPendingCanvasSave,
	drainCanvasSaveQueue,
	flushPendingCanvasSave,
	getPendingCanvasSave,
	registerCanvasSaveFlusher,
	rememberPendingCanvasSave,
} from "@/features/canvases/client/save-state";
import type { Canvas } from "@/features/canvases/schemas";

describe("canvas save flush registry", () => {
	it("flushes the mounted surface before replacing its tldraw store", async () => {
		let calls = 0;
		const unregister = registerCanvasSaveFlusher("canvas_1", async () => {
			calls += 1;
			return true;
		});

		await expect(flushPendingCanvasSave("canvas_1")).resolves.toBe(true);
		expect(calls).toBe(1);

		unregister();
		await expect(flushPendingCanvasSave("canvas_1")).resolves.toBe(true);
	});

	it("does not let stale cleanup remove a newer surface registration", async () => {
		const unregisterOld = registerCanvasSaveFlusher(
			"canvas_2",
			async () => false,
		);
		registerCanvasSaveFlusher("canvas_2", async () => true);

		unregisterOld();
		await expect(flushPendingCanvasSave("canvas_2")).resolves.toBe(true);
	});
});

describe("drainCanvasSaveQueue", () => {
	it("serializes an edit made while the preceding snapshot is saving", async () => {
		let dirty = true;
		let saves = 0;

		const saved = await drainCanvasSaveQueue({
			clearPendingTimer: () => {},
			hasPendingChanges: () => dirty,
			save: async () => {
				saves += 1;
				dirty = false;
				if (saves === 1) dirty = true;
				return true;
			},
		});

		expect(saved).toBe(true);
		expect(saves).toBe(2);
	});

	it("keeps the surface mounted when persistence reports an error", async () => {
		let saves = 0;
		const saved = await drainCanvasSaveQueue({
			clearPendingTimer: () => {},
			hasPendingChanges: () => true,
			save: async () => {
				saves += 1;
				return false;
			},
		});

		expect(saved).toBe(false);
		expect(saves).toBe(1);
	});
});

describe("canvas snapshot cache", () => {
	it("advances the snapshot and concurrency version together after a save", async () => {
		const queryClient = new QueryClient();
		const id = "2d8ed4e8-4f61-4e27-9ae8-04d9212b7c19";
		const initialUpdatedAt = "2026-07-17T10:00:00.000Z";
		const savedUpdatedAt = "2026-07-17T10:00:01.000Z";
		const canvas: Canvas = {
			id,
			userId: "user_1",
			workspaceId: "workspace_1",
			pageId: "30e7a4bf-a661-438e-bbc2-35f4b71a5ee2",
			snapshot: { version: 1 },
			createdAt: initialUpdatedAt,
			updatedAt: initialUpdatedAt,
		};
		const options = getCanvasQueryOptions(id);
		queryClient.setQueryData(options.queryKey, canvas);

		await setCanvasSnapshotInCache(
			queryClient,
			id,
			{ version: 2 },
			savedUpdatedAt,
		);

		expect(queryClient.getQueryData<Canvas>(options.queryKey)).toEqual({
			...canvas,
			snapshot: { version: 2 },
			updatedAt: savedUpdatedAt,
		});
	});

	it("cancels an older refetch before staging a local snapshot", async () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const id = "9cfef31e-df69-4770-94d8-a53c5ff6d959";
		const updatedAt = "2026-07-17T10:00:00.000Z";
		const canvas: Canvas = {
			id,
			userId: "user_1",
			workspaceId: "workspace_1",
			pageId: "a0df810a-e1e3-4857-aa44-d8f909fa5563",
			snapshot: { version: 1 },
			createdAt: updatedAt,
			updatedAt,
		};
		const options = getCanvasQueryOptions(id);
		queryClient.setQueryData(options.queryKey, canvas);
		let markStarted = () => {};
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const staleRefetch = queryClient
			.fetchQuery({
				queryKey: options.queryKey,
				queryFn: ({ signal }) =>
					new Promise<Canvas>((_resolve, reject) => {
						markStarted();
						signal.addEventListener(
							"abort",
							() => reject(new Error("cancelled stale canvas refetch")),
							{ once: true },
						);
					}),
			})
			.catch(() => undefined);

		await started;
		await setCanvasSnapshotInCache(queryClient, id, { version: 2 });
		await staleRefetch;

		expect(queryClient.getQueryData<Canvas>(options.queryKey)).toEqual({
			...canvas,
			snapshot: { version: 2 },
		});
	});
});

describe("pending canvas saves", () => {
	it("survives remounts until the exact pending snapshot is saved", () => {
		const id = "56fc14c1-127a-4a1c-942a-b3e5f445b68f";
		const first = rememberPendingCanvasSave(id, {
			snapshot: { version: 1 },
			baseUpdatedAt: "2026-07-17T10:00:00.000Z",
		});
		expect(getPendingCanvasSave(id)).toBe(first);

		const newer = rememberPendingCanvasSave(id, {
			snapshot: { version: 2 },
			baseUpdatedAt: "2026-07-17T10:00:01.000Z",
		});
		clearPendingCanvasSave(id, first);
		expect(getPendingCanvasSave(id)).toBe(newer);

		clearPendingCanvasSave(id, newer);
		expect(getPendingCanvasSave(id)).toBeNull();
	});
});

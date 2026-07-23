import { describe, expect, it } from "bun:test";
import {
	createInFlightSaveQueueStore,
	createLatestSaveQueueStore,
	drainLatestSaveQueue,
	drainPageSaveQueue,
	flushPendingPageSave,
	registerPageSaveFlusher,
} from "@/features/pages/client/save-state";

describe("page save flush registry", () => {
	it("flushes the registered page save before share actions continue", async () => {
		let calls = 0;
		const unregister = registerPageSaveFlusher("page_1", async () => {
			calls += 1;
			return calls === 2;
		});

		await expect(flushPendingPageSave("page_1")).resolves.toBe(false);
		await expect(flushPendingPageSave("page_1")).resolves.toBe(true);
		expect(calls).toBe(2);

		unregister();
		await expect(flushPendingPageSave("page_1")).resolves.toBe(true);
	});

	it("flushes independent title and document queues together", async () => {
		const calls: string[] = [];
		const unregisterTitle = registerPageSaveFlusher("page_2", async () => {
			calls.push("title");
			return true;
		});
		const unregisterDocument = registerPageSaveFlusher("page_2", async () => {
			calls.push("document");
			return false;
		});

		await expect(flushPendingPageSave("page_2")).resolves.toBe(false);
		expect(calls.sort()).toEqual(["document", "title"]);

		unregisterDocument();
		await expect(flushPendingPageSave("page_2")).resolves.toBe(true);
		unregisterTitle();
	});
});

describe("drainPageSaveQueue", () => {
	it("keeps saving until edits made during an in-flight save are clean", async () => {
		let dirty = true;
		let saveCount = 0;
		let clearedTimers = 0;

		const saved = await drainPageSaveQueue({
			clearPendingTimer: () => {
				clearedTimers += 1;
			},
			hasPendingChanges: () => dirty,
			save: async () => {
				saveCount += 1;
				dirty = false;
				if (saveCount === 1) {
					dirty = true;
				}
				return true;
			},
		});

		expect(saved).toBe(true);
		expect(saveCount).toBe(2);
		expect(clearedTimers).toBe(2);
	});

	it("stops when a save reports a conflict", async () => {
		let saveCount = 0;

		const saved = await drainPageSaveQueue({
			clearPendingTimer: () => {},
			hasPendingChanges: () => true,
			save: async () => {
				saveCount += 1;
				return false;
			},
		});

		expect(saved).toBe(false);
		expect(saveCount).toBe(1);
	});
});

describe("drainLatestSaveQueue", () => {
	it("saves the latest draft after an older in-flight save fails", async () => {
		const latest = { title: "Latest" };
		let pending: typeof latest | null = latest;
		let inFlight: Promise<boolean> | null = null;
		inFlight = Promise.resolve(false).finally(() => {
			inFlight = null;
		});
		const savedTitles: string[] = [];

		const saved = await drainLatestSaveQueue({
			clearPendingTimer: () => {},
			getInFlightSave: () => inFlight,
			getPendingValue: () => pending,
			save: async (draft) => {
				savedTitles.push(draft.title);
				if (pending === draft) pending = null;
				return true;
			},
		});

		expect(saved).toBe(true);
		expect(savedTitles).toEqual(["Latest"]);
	});

	it("reports a failure when retrying the current draft fails", async () => {
		const latest = { title: "Still pending" };
		let attempts = 0;

		const saved = await drainLatestSaveQueue({
			clearPendingTimer: () => {},
			getInFlightSave: () => null,
			getPendingValue: () => latest,
			save: async () => {
				attempts += 1;
				return false;
			},
		});

		expect(saved).toBe(false);
		expect(attempts).toBe(1);
	});
});

describe("latest save queue store", () => {
	it("reuses a page queue while an unmounted consumer still has work", async () => {
		const store = createLatestSaveQueueStore<{ title: string }, boolean>();
		const first = store.get("page_1");
		const release = store.retain(first);
		first.pending = { title: "Older draft" };
		first.inFlight = Promise.resolve(true);

		release();
		await Promise.resolve();

		const remounted = store.get("page_1");
		expect(remounted).toBe(first);

		remounted.pending = null;
		remounted.inFlight = null;
		store.evictIfIdle(remounted);
		expect(store.get("page_1")).not.toBe(first);
	});
});

describe("in-flight save queue store", () => {
	it("shares an exact save result with a replacement consumer", async () => {
		const store = createInFlightSaveQueueStore<{ version: string }>();
		const first = store.get("page_1");
		const releaseFirst = store.retain(first);
		let resolveSave: ((result: { version: string }) => void) | undefined;
		const request = new Promise<{ version: string }>((resolve) => {
			resolveSave = resolve;
		});
		const tracked = store.track(first, request);

		releaseFirst();
		await Promise.resolve();
		const replacement = store.get("page_1");
		const releaseReplacement = store.retain(replacement);
		expect(replacement).toBe(first);

		resolveSave?.({ version: "v2" });
		await expect(tracked).resolves.toEqual({ version: "v2" });
		expect(replacement.lastResult).toEqual({ version: "v2" });

		releaseReplacement();
		await Promise.resolve();
		expect(store.get("page_1")).not.toBe(first);
	});
});

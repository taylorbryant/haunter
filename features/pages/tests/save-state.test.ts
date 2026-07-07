import { describe, expect, it } from "bun:test";
import {
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

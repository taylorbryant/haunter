import { describe, expect, it } from "bun:test";
import {
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

	it("flushes independent title and document actors together", async () => {
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

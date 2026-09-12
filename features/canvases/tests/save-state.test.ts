import { describe, expect, it } from "bun:test";
import {
	flushPendingCanvasSave,
	registerCanvasSaveFlusher,
} from "@/features/canvases/client/save-state";

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

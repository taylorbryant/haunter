import { describe, expect, it } from "bun:test";
import {
	isLoadableSnapshot,
	loadableSnapshot,
} from "@/features/canvases/lib/snapshot";

describe("canvas snapshot validation", () => {
	it("rejects legacy objects that would crash tldraw migration", () => {
		const legacy = { shape: { id: "shape:1" } };

		expect(isLoadableSnapshot(legacy)).toBe(false);
		expect(loadableSnapshot(legacy)).toBeUndefined();
	});

	it("accepts snapshots with schema and store records", () => {
		const snapshot = {
			schema: { schemaVersion: 2 },
			store: { "shape:1": { id: "shape:1", typeName: "shape" } },
		};

		expect(isLoadableSnapshot(snapshot)).toBe(true);
		const loadable: unknown = loadableSnapshot(snapshot);
		expect(loadable).toBe(snapshot);
	});
});

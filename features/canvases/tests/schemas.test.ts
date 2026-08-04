import { describe, expect, test } from "bun:test";
import { SaveCanvasSnapshotBodySchema } from "@/features/canvases/schemas";

describe("canvas write boundaries", () => {
	test("rejects legacy whole-snapshot save payloads", () => {
		const result = SaveCanvasSnapshotBodySchema.safeParse({
			snapshot: {},
			baseUpdatedAt: new Date().toISOString(),
		});

		expect(result.success).toBe(false);
	});
});

import { describe, expect, it } from "bun:test";
import { textAutoSizeWidthWithSafetyMargin } from "@/features/canvases/lib/shape-utils";

describe("canvas shape utilities", () => {
	it("leaves a full rendered pixel beyond a fractional text measurement", () => {
		expect(textAutoSizeWidthWithSafetyMargin(171.78125)).toBe(173);
	});

	it("still leaves a safety pixel when the measurement is already whole", () => {
		expect(textAutoSizeWidthWithSafetyMargin(172)).toBe(173);
	});
});

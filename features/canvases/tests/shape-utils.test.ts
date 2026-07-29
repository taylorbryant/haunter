import { describe, expect, it } from "bun:test";
import {
	scaledTextAutoSizeWidthWithSafetyMargin,
	textAutoSizeAlignmentCorrection,
	textAutoSizeWidthWithSafetyMargin,
} from "@/features/canvases/lib/shape-utils";

describe("canvas shape utilities", () => {
	it("leaves a full rendered pixel beyond a fractional text measurement", () => {
		expect(textAutoSizeWidthWithSafetyMargin(171.78125)).toBe(173);
	});

	it("still leaves a safety pixel when the measurement is already whole", () => {
		expect(textAutoSizeWidthWithSafetyMargin(172)).toBe(173);
	});

	it("preserves the anchor for each text alignment during updates", () => {
		expect(textAutoSizeAlignmentCorrection(171.78125, "start", 1)).toBe(0);
		expect(textAutoSizeAlignmentCorrection(171.78125, "middle", 1)).toBe(
			0.609375,
		);
		expect(textAutoSizeAlignmentCorrection(171.78125, "end", 1)).toBe(1.21875);
	});

	it("applies the safety margin before scaling text geometry", () => {
		const scaledMeasurement = 171.78125 * 2;

		expect(scaledTextAutoSizeWidthWithSafetyMargin(scaledMeasurement, 2)).toBe(
			346,
		);
		expect(
			textAutoSizeAlignmentCorrection(scaledMeasurement, "middle", 2),
		).toBe(1.21875);
		expect(textAutoSizeAlignmentCorrection(scaledMeasurement, "end", 2)).toBe(
			2.4375,
		);
	});
});

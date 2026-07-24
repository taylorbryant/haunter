import { describe, expect, it } from "bun:test";
import { formatViewedAt } from "@/features/pages/lib/format-viewed-at";

const NOW = Date.parse("2026-07-24T18:00:00.000Z");

describe("formatViewedAt", () => {
	it("formats recent views in human-readable units", () => {
		expect(formatViewedAt("2026-07-24T17:59:45.000Z", NOW)).toBe(
			"Viewed just now",
		);
		expect(formatViewedAt("2026-07-24T17:55:00.000Z", NOW)).toBe(
			"Viewed 5m ago",
		);
		expect(formatViewedAt("2026-07-24T15:00:00.000Z", NOW)).toBe(
			"Viewed 3h ago",
		);
		expect(formatViewedAt("2026-07-22T18:00:00.000Z", NOW)).toBe(
			"Viewed 2d ago",
		);
	});

	it("uses a date for older views", () => {
		expect(formatViewedAt("2026-07-01T18:00:00.000Z", NOW)).toBe(
			"Viewed Jul 1",
		);
	});
});

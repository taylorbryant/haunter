import { describe, expect, it } from "bun:test";
import { formatEditedAt } from "@/features/pages/lib/format-edited-at";

const NOW = Date.parse("2026-07-03T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatEditedAt", () => {
	it("shows 'Just now' for edits under a minute old", () => {
		expect(formatEditedAt(ago(0), NOW)).toBe("Just now");
		expect(formatEditedAt(ago(30 * SECOND), NOW)).toBe("Just now");
	});

	it("shows minutes, hours, and days", () => {
		expect(formatEditedAt(ago(5 * MINUTE), NOW)).toBe("Edited 5m ago");
		expect(formatEditedAt(ago(2 * HOUR), NOW)).toBe("Edited 2h ago");
		expect(formatEditedAt(ago(3 * DAY), NOW)).toBe("Edited 3d ago");
	});

	it("falls back to a short date after a week", () => {
		const label = formatEditedAt(ago(10 * DAY), NOW);
		expect(label).toMatch(/^Edited [A-Z][a-z]{2} \d{1,2}$/);
	});

	it("returns a stable fallback for an unparseable timestamp", () => {
		expect(formatEditedAt("not-a-date", NOW)).toBe("Saved");
	});
});

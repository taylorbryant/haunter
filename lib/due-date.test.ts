import { describe, expect, it } from "bun:test";
import { formatDueDateTimeLabel, parseIsoDate } from "./due-date";

describe("due date labels", () => {
	it("uses the supplied local date instead of the runtime timezone", () => {
		expect(
			formatDueDateTimeLabel("2026-07-25", null, parseIsoDate("2026-07-24")),
		).toBe("Tomorrow");
	});
});

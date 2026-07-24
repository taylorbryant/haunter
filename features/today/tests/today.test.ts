import { describe, expect, it } from "bun:test";
import { formatTodayDate } from "@/features/today/lib/today";

describe("Today helpers", () => {
	it("formats the account-local date without applying the browser timezone", () => {
		expect(formatTodayDate("2026-07-09")).toBe("Thursday, July 9");
	});
});

import { describe, expect, it } from "bun:test";
import {
	formatTaskReminderLabel,
	parseTaskReminderOffset,
} from "@/features/tasks/lib/reminder-options";

describe("task reminder options", () => {
	it("uses the date-only delivery time for an at-due-time reminder", () => {
		expect(formatTaskReminderLabel(0, null)).toBe("Morning of, 9:00 AM");
		expect(formatTaskReminderLabel(0, "14:30")).toBe("At due time");
	});

	it("formats the supported offsets", () => {
		expect(formatTaskReminderLabel(15, "14:30")).toBe("15 minutes before");
		expect(formatTaskReminderLabel(60, "14:30")).toBe("1 hour before");
		expect(formatTaskReminderLabel(1_440, "14:30")).toBe("1 day before");
		expect(formatTaskReminderLabel(null, "14:30")).toBe("No reminder");
	});

	it("only parses supported reminder values", () => {
		expect(parseTaskReminderOffset("0")).toBe(0);
		expect(parseTaskReminderOffset("15")).toBe(15);
		expect(parseTaskReminderOffset("60")).toBe(60);
		expect(parseTaskReminderOffset("1440")).toBe(1_440);
		expect(parseTaskReminderOffset("30")).toBeNull();
		expect(parseTaskReminderOffset("none")).toBeNull();
	});
});

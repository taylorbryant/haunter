import { describe, expect, it } from "bun:test";
import { formatDueDatePickerAccessibleName } from "@/features/tasks/lib/due-date-accessibility";

describe("due date picker accessible name", () => {
	it("includes the visible date, time, and configured reminder", () => {
		expect(
			formatDueDatePickerAccessibleName({
				action: "Change due date",
				dueDate: "2026-07-28",
				dueTime: "14:30",
				reminderOffsetMinutes: 60,
				today: "2026-07-27",
			}),
		).toBe("Change due date, Tomorrow, 2:30 PM, 1 hour before");
	});

	it("describes empty, loading, and disabled states", () => {
		expect(
			formatDueDatePickerAccessibleName({
				action: "Set due date",
				dueDate: null,
				dueTime: null,
				reminderOffsetMinutes: null,
				today: "2026-07-27",
			}),
		).toBe("Set due date, no due date");
		expect(
			formatDueDatePickerAccessibleName({
				action: "Set due date",
				dueDate: null,
				dueTime: null,
				reminderOffsetMinutes: null,
				today: null,
				loading: true,
				disabled: true,
			}),
		).toBe("Set due date, loading, disabled");
	});
});

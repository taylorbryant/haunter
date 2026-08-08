import { describe, expect, test } from "bun:test";
import {
	hasTaskSchedulingChanged,
	type TaskSchedulingState,
} from "@/features/tasks/lib/task-scheduling";

const baseline = {
	dueDate: "2026-08-08",
	dueTime: "09:00",
	reminderOffsetMinutes: 15,
	assigneeId: "user_1",
} satisfies TaskSchedulingState;

describe("task scheduling changes", () => {
	test("does not report unchanged scheduling state", () => {
		expect(hasTaskSchedulingChanged(baseline, { ...baseline })).toBe(false);
	});

	for (const [field, value] of [
		["dueDate", "2026-08-09"],
		["dueTime", null],
		["reminderOffsetMinutes", 60],
		["assigneeId", "user_2"],
	] as const) {
		test(`reports a changed ${field}`, () => {
			expect(
				hasTaskSchedulingChanged(baseline, {
					...baseline,
					[field]: value,
				}),
			).toBe(true);
		});
	}
});

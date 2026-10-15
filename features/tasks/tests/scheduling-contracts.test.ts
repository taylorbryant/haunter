import { describe, expect, it } from "bun:test";
import {
	TaskOverdueNotificationPayloadSchema,
	TaskReminderNotificationPayloadSchema,
} from "@/features/notifications/schemas";
import { createTaskAgentCapabilities } from "@/features/tasks/agent-capabilities";
import {
	parseTaskReminderOffset,
	TASK_REMINDER_OPTIONS,
} from "@/features/tasks/lib/reminder-options";
import {
	CreateTaskInputSchema,
	UpdateTaskBodySchema,
} from "@/features/tasks/schemas";

const [, createTask, updateTask] = createTaskAgentCapabilities();
const input = { workspaceId: "workspace_test", title: "Scheduled task" };
const taskId = "f12c0b14-f2b4-4a08-8fc5-b266ae7fbf99";
const payload = {
	taskId,
	title: input.title,
	pageId: null,
	sourceBlockId: null,
};

describe("shared task scheduling contracts", () => {
	for (const option of TASK_REMINDER_OPTIONS.filter(
		({ value }) => value !== "none",
	)) {
		it(`accepts the picker reminder ${option.value} through HTTP, MCP, and notifications`, () => {
			const schedule = {
				dueDate: "2026-10-15",
				dueTime: "09:00",
				reminderOffsetMinutes: parseTaskReminderOffset(option.value),
			};
			expect(schedule.reminderOffsetMinutes).not.toBeNull();
			expect(
				CreateTaskInputSchema.parse({ ...input, ...schedule }),
			).toMatchObject(schedule);
			expect(createTask.input.parse({ ...input, ...schedule })).toMatchObject(
				schedule,
			);
			expect(UpdateTaskBodySchema.parse(schedule)).toEqual(schedule);
			expect(
				updateTask.input.parse({ ...input, taskId, ...schedule }),
			).toMatchObject(schedule);
			expect(
				TaskReminderNotificationPayloadSchema.parse({
					...payload,
					...schedule,
				}),
			).toMatchObject(schedule);
		});
	}

	it("rejects malformed scheduling values in every contract", () => {
		for (const invalid of [
			{ dueDate: "tomorrow" },
			{ dueDate: "2026-1-15" },
			{ dueTime: "9:00" },
			{ dueTime: "24:00" },
			{ dueTime: "09:60" },
			{ reminderOffsetMinutes: 30 },
			{ reminderOffsetMinutes: -15 },
			{ reminderOffsetMinutes: "15" },
			{ reminderOffsetMinutes: Number.NaN },
		]) {
			const schedule = {
				dueDate: "2026-10-15",
				dueTime: "09:00",
				reminderOffsetMinutes: 0,
				...invalid,
			};
			expect(
				CreateTaskInputSchema.safeParse({ ...input, ...schedule }).success,
			).toBe(false);
			expect(
				createTask.input.safeParse({ ...input, ...schedule }).success,
			).toBe(false);
			expect(UpdateTaskBodySchema.safeParse(schedule).success).toBe(false);
			expect(
				updateTask.input.safeParse({ ...input, taskId, ...schedule }).success,
			).toBe(false);
			expect(
				TaskReminderNotificationPayloadSchema.safeParse({
					...payload,
					...schedule,
				}).success,
			).toBe(false);
		}
	});

	it("requires a due date for new timed tasks and reminders, including offset zero", () => {
		for (const schedule of [
			{ dueTime: "09:00" },
			{ reminderOffsetMinutes: 0 },
			{ reminderOffsetMinutes: 15 },
		]) {
			for (const schema of [CreateTaskInputSchema, createTask.input]) {
				const result = schema.safeParse({ ...input, ...schedule });
				expect(result.success).toBe(false);
				if (result.success)
					throw new Error("Expected a missing due date error");
				expect(result.error.issues[0]?.path).toEqual(["dueDate"]);
			}
		}
	});

	it("preserves optional creation fields, nullable patches, and MCP title trimming", () => {
		const paddedTitle = { ...input, title: "  Scheduled task  " };
		expect(CreateTaskInputSchema.parse(paddedTitle)).toEqual(paddedTitle);
		expect(createTask.input.parse(paddedTitle)).toEqual(input);
		expect(createTask.input.safeParse({ ...input, title: "   " }).success).toBe(
			false,
		);
		for (const patch of [
			{ dueTime: "09:00" },
			{ reminderOffsetMinutes: 0 },
			{ dueDate: null, dueTime: null, reminderOffsetMinutes: null },
		] as const) {
			expect(UpdateTaskBodySchema.parse(patch)).toEqual(patch);
			expect(
				updateTask.input.parse({
					workspaceId: input.workspaceId,
					taskId,
					...patch,
				}),
			).toMatchObject(patch);
		}
	});

	it("still reads legacy overdue notifications without a due time", () => {
		expect(
			TaskOverdueNotificationPayloadSchema.parse({
				...payload,
				dueDate: "2026-10-15",
			}).dueTime,
		).toBeNull();
	});
});

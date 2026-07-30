import { describe, expect, it } from "bun:test";
import {
	createInlineNotificationDispatcher,
	type NotificationPreferencesPort,
} from "@beignet/core/notifications";
import type { AppContext } from "@/app-context";
import type {
	PendingPushNotification,
	TaskReminderCandidate,
} from "@/features/notifications/ports";
import type { Notification } from "@/features/notifications/schemas";
import {
	deliverTaskReminderNotifications,
	shouldCreateTaskReminder,
	TaskReminderNotification,
	zonedDateTimeToUtc,
} from "@/features/tasks/notifications/reminder";
import { processOverdueNotifications } from "@/features/tasks/schedules/check-overdue";
import { notificationPreferences } from "@/server/notification-preferences";

function candidate(
	overrides: Partial<TaskReminderCandidate> = {},
): TaskReminderCandidate {
	return {
		taskId: crypto.randomUUID(),
		title: "Prepare the launch",
		dueDate: "2026-07-10",
		dueTime: "10:00",
		reminderOffsetMinutes: 60,
		pageId: null,
		sourceBlockId: null,
		userId: "user_test",
		workspaceId: "workspace_test",
		timezone: "America/Chicago",
		entityVersion: "version_test",
		reminderConfiguredAt: "2026-07-09T12:00:00.000Z",
		...overrides,
	};
}

function pendingReminder(
	overrides: Partial<
		Extract<PendingPushNotification, { kind: "task.reminder" }>
	> = {},
): PendingPushNotification {
	const item = candidate();
	return {
		id: crypto.randomUUID(),
		userId: item.userId,
		workspaceId: item.workspaceId,
		kind: "task.reminder",
		entityId: item.taskId,
		entityVersion: item.entityVersion,
		payload: {
			taskId: item.taskId,
			title: item.title,
			dueDate: item.dueDate,
			dueTime: item.dueTime,
			reminderOffsetMinutes: item.reminderOffsetMinutes,
			pageId: item.pageId,
			sourceBlockId: item.sourceBlockId,
		},
		readAt: null,
		createdAt: "2026-07-10T14:00:00.000Z",
		pushAttempts: 0,
		...overrides,
	};
}

describe("proactive task reminder timing", () => {
	function localParts(at: Date, timezone: string) {
		return new Intl.DateTimeFormat("en-CA", {
			timeZone: timezone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		})
			.formatToParts(at)
			.reduce<Record<string, string>>((result, part) => {
				if (part.type !== "literal") result[part.type] = part.value;
				return result;
			}, {});
	}

	it("resolves ordinary wall times exactly", () => {
		const result = zonedDateTimeToUtc("2026-07-10", "10:00", "America/Chicago");
		expect(result.toISOString()).toBe("2026-07-10T15:00:00.000Z");
		expect(localParts(result, "America/Chicago")).toMatchObject({
			year: "2026",
			month: "07",
			day: "10",
			hour: "10",
			minute: "00",
		});
	});

	it("advances nonexistent spring-forward times by the transition gap", () => {
		const result = zonedDateTimeToUtc("2026-03-08", "02:30", "America/Chicago");
		expect(result.toISOString()).toBe("2026-03-08T08:30:00.000Z");
		expect(localParts(result, "America/Chicago")).toMatchObject({
			year: "2026",
			month: "03",
			day: "08",
			hour: "03",
			minute: "30",
		});
	});

	it("chooses the earlier occurrence of an ambiguous fall-back time", () => {
		const result = zonedDateTimeToUtc("2026-11-01", "01:30", "America/Chicago");
		expect(result.toISOString()).toBe("2026-11-01T06:30:00.000Z");
		expect(localParts(result, "America/Chicago")).toMatchObject({
			year: "2026",
			month: "11",
			day: "01",
			hour: "01",
			minute: "30",
		});
	});

	it("uses the assignee timezone and configured offset", () => {
		const item = candidate();
		expect(
			shouldCreateTaskReminder(item, new Date("2026-07-10T13:59:59.000Z")),
		).toBe(false);
		expect(
			shouldCreateTaskReminder(item, new Date("2026-07-10T14:00:00.000Z")),
		).toBe(true);
	});

	it("uses 9 AM for a date-only task and permits the rest of its due day", () => {
		const item = candidate({ dueTime: null, reminderOffsetMinutes: 0 });
		expect(
			shouldCreateTaskReminder(item, new Date("2026-07-10T13:59:59.000Z")),
		).toBe(false);
		expect(
			shouldCreateTaskReminder(item, new Date("2026-07-11T04:59:59.000Z")),
		).toBe(true);
		expect(
			shouldCreateTaskReminder(item, new Date("2026-07-11T05:00:00.000Z")),
		).toBe(false);
	});

	it("allows a late configuration before the due instant", () => {
		const item = candidate({
			reminderConfiguredAt: "2026-07-10T14:30:00.000Z",
		});
		expect(
			shouldCreateTaskReminder(item, new Date("2026-07-10T14:35:00.000Z")),
		).toBe(true);
		expect(
			shouldCreateTaskReminder(
				{ ...item, reminderConfiguredAt: "2026-07-10T15:00:01.000Z" },
				new Date("2026-07-10T15:05:00.000Z"),
			),
		).toBe(false);
	});

	it("limits timed reminders to the ten-minute cron grace window", () => {
		const item = candidate({ reminderOffsetMinutes: 0 });
		expect(
			shouldCreateTaskReminder(item, new Date("2026-07-10T15:09:59.000Z")),
		).toBe(true);
		expect(
			shouldCreateTaskReminder(item, new Date("2026-07-10T15:10:00.000Z")),
		).toBe(false);
	});

	it("resolves due times correctly after a daylight-saving transition", () => {
		const item = candidate({
			dueDate: "2026-03-08",
			dueTime: "09:00",
			reminderOffsetMinutes: 0,
			reminderConfiguredAt: "2026-03-07T12:00:00.000Z",
		});
		expect(
			shouldCreateTaskReminder(item, new Date("2026-03-08T13:59:59.000Z")),
		).toBe(false);
		expect(
			shouldCreateTaskReminder(item, new Date("2026-03-08T14:00:00.000Z")),
		).toBe(true);
	});
});

describe("proactive task reminder schedule", () => {
	it("creates the inbox reminder and dispatches its push batch", async () => {
		const item = candidate();
		const pending: PendingPushNotification[] = [];
		const deliveries: unknown[] = [];
		const notificationInbox = {
			async rearmDueSnoozes() {
				return 0;
			},
			async findReminderCandidates() {
				return { items: [item], nextCursor: null };
			},
			async createTaskReminder(
				current: TaskReminderCandidate,
				createdAt: string,
			) {
				const notification: Notification = {
					id: crypto.randomUUID(),
					userId: current.userId,
					workspaceId: current.workspaceId,
					kind: "task.reminder",
					entityId: current.taskId,
					entityVersion: current.entityVersion,
					payload: {
						taskId: current.taskId,
						title: current.title,
						dueDate: current.dueDate,
						dueTime: current.dueTime,
						reminderOffsetMinutes: current.reminderOffsetMinutes,
						pageId: current.pageId,
						sourceBlockId: current.sourceBlockId,
					},
					readAt: null,
					createdAt,
				};
				pending.push({ ...notification, pushAttempts: 0 });
				return notification;
			},
			async findOverdueCandidates() {
				return [];
			},
			async createOverdue() {
				return null;
			},
			async listPendingPush() {
				return pending;
			},
			async listValidReminderPush(ids: string[]) {
				return ids;
			},
			async markPushSkipped() {},
		};
		const ctx = {
			ports: {
				notificationInbox,
				notifications: {
					async send(_definition: unknown, payload: unknown) {
						deliveries.push(payload);
						return {
							notificationName: "tasks.reminder",
							payload,
							channels: ["push"],
							results: [],
						};
					},
				},
			},
		} as unknown as AppContext;

		const result = await processOverdueNotifications(
			ctx,
			new Date("2026-07-10T14:00:00.000Z"),
		);

		expect(result.remindersCreated).toBe(1);
		expect(result.created).toBe(0);
		expect(result.deliveryGroups).toBe(1);
		expect(deliveries).toHaveLength(1);
	});

	it("keyset-pages past an inactive prefix to an actionable reminder", async () => {
		const inactive = Array.from({ length: 250 }, (_, index) =>
			candidate({
				taskId: `inactive_${index}`,
				dueDate: "2026-07-11",
				entityVersion: `inactive_version_${index}`,
			}),
		);
		const actionable = candidate({ taskId: "actionable" });
		let pagesRead = 0;
		const created: string[] = [];
		const notificationInbox = {
			async rearmDueSnoozes() {
				return 0;
			},
			async findReminderCandidates({
				cursor,
			}: {
				cursor?: { taskId: string };
			}) {
				pagesRead += 1;
				return cursor
					? { items: [actionable], nextCursor: null }
					: {
							items: inactive,
							nextCursor: {
								dueDate: "2026-07-11",
								dueTime: "10:00",
								createdAt: "2026-07-09T12:00:00.000Z",
								taskId: "inactive_249",
							},
						};
			},
			async createTaskReminder(current: TaskReminderCandidate) {
				created.push(current.taskId);
				return {} as Notification;
			},
			async findOverdueCandidates() {
				return [];
			},
			async createOverdue() {
				return null;
			},
			async listPendingPush() {
				return [];
			},
		};
		const ctx = {
			ports: { notificationInbox },
		} as unknown as AppContext;

		const result = await processOverdueNotifications(
			ctx,
			new Date("2026-07-10T14:00:00.000Z"),
		);

		expect(pagesRead).toBe(2);
		expect(result.reminderCandidates).toBe(251);
		expect(created).toEqual(["actionable"]);
	});

	it("skips a pending push after its task configuration becomes stale", async () => {
		const current = pendingReminder();
		const skipped: string[][] = [];
		const sent: unknown[] = [];
		const ctx = {
			ports: {
				notificationInbox: {
					async listValidReminderPush() {
						return [];
					},
					async markPushSkipped(ids: string[]) {
						skipped.push(ids);
					},
				},
				notifications: {
					async send(_definition: unknown, payload: unknown) {
						sent.push(payload);
					},
				},
			},
		} as unknown as AppContext;

		const groups = await deliverTaskReminderNotifications(ctx, [current]);

		expect(groups).toBe(0);
		expect(skipped).toEqual([[current.id]]);
		expect(sent).toEqual([]);
	});

	it("keeps retry attempts in separate delivery batches", async () => {
		const first = pendingReminder({ pushAttempts: 0 });
		const second = pendingReminder({ pushAttempts: 1 });
		const deliveries: Array<{ attempt: number }> = [];
		const ctx = {
			ports: {
				notificationInbox: {
					async listValidReminderPush() {
						return [first.id, second.id];
					},
					async markPushSkipped() {},
				},
				notifications: {
					async send(_definition: unknown, payload: { attempt: number }) {
						deliveries.push(payload);
					},
				},
			},
		} as unknown as AppContext;

		expect(await deliverTaskReminderNotifications(ctx, [first, second])).toBe(
			2,
		);
		expect(deliveries.map((delivery) => delivery.attempt)).toEqual([1, 2]);
	});
});

describe("task reminder push preferences", () => {
	it("skips disabled task reminders", async () => {
		const item = pendingReminder();
		const skipped: string[][] = [];
		const ctx = {
			ports: {
				notificationInbox: {
					async getPreferences() {
						return {
							overdueTasksEnabled: true,
							taskAssignmentsEnabled: true,
							taskRemindersEnabled: false,
							timezone: "UTC",
							timezoneConfigured: true,
						};
					},
					async markPushSkipped(ids: string[]) {
						skipped.push(ids);
					},
				},
			},
		} as unknown as AppContext;
		const notifications = createInlineNotificationDispatcher<AppContext>({
			ctx,
			preferences:
				notificationPreferences as NotificationPreferencesPort<AppContext>,
			failureMode: "throw",
		});

		const result = await notifications.send(TaskReminderNotification, {
			userId: item.userId,
			workspaceId: item.workspaceId,
			notificationIds: [item.id],
			attempt: 1,
			items: item.kind === "task.reminder" ? [item.payload] : [],
		});

		expect(result.results[0]).toMatchObject({
			status: "skipped",
			reason: "Task reminders are disabled.",
		});
		expect(skipped).toEqual([[item.id]]);
	});
});

import { afterEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
	member,
	notificationPreferences,
	notifications,
	organization,
	tasks,
	user,
} from "@/infra/db/schema";
import type { TestDatabase } from "@/infra/db/test-database";
import { createTestDatabase } from "@/infra/db/test-database";

let database: TestDatabase | null = null;

afterEach(async () => {
	await database?.close();
	database = null;
});

describe("notification timezone preferences", () => {
	it("initializes once and only changes again through an intentional update", async () => {
		database = await createTestDatabase();
		const now = new Date();
		await database.db.insert(user).values({
			id: "user_timezone",
			name: "Timezone User",
			email: "timezone@example.com",
			createdAt: now,
			updatedAt: now,
		});

		const repository = database.repositories.notificationInbox;
		expect(await repository.getPreferences("user_timezone")).toEqual({
			overdueTasksEnabled: true,
			taskAssignmentsEnabled: true,
			taskRemindersEnabled: true,
			timezone: "UTC",
			timezoneConfigured: false,
		});

		await repository.initializeTimezone("user_timezone", "America/Chicago");
		await repository.initializeTimezone("user_timezone", "Europe/London");
		expect(await repository.getPreferences("user_timezone")).toEqual({
			overdueTasksEnabled: true,
			taskAssignmentsEnabled: true,
			taskRemindersEnabled: true,
			timezone: "America/Chicago",
			timezoneConfigured: true,
		});

		await repository.updatePreferences("user_timezone", {
			timezone: "Europe/London",
		});
		await repository.updatePreferences("user_timezone", {
			overdueTasksEnabled: false,
			taskAssignmentsEnabled: false,
			taskRemindersEnabled: true,
		});
		expect(await repository.getPreferences("user_timezone")).toEqual({
			overdueTasksEnabled: false,
			taskAssignmentsEnabled: false,
			taskRemindersEnabled: true,
			timezone: "Europe/London",
			timezoneConfigured: true,
		});
	});
});

describe("task assignment notifications", () => {
	it("persists the assignment payload and deduplicates the same event", async () => {
		database = await createTestDatabase();
		const now = new Date();
		await database.db.insert(user).values({
			id: "user_assigned",
			name: "Assigned User",
			email: "assigned@example.com",
			createdAt: now,
			updatedAt: now,
		});
		await database.db.insert(user).values({
			id: "user_replacement",
			name: "Replacement User",
			email: "replacement@example.com",
			createdAt: now,
			updatedAt: now,
		});
		await database.db.insert(organization).values({
			id: "workspace_test",
			name: "Test workspace",
			slug: `test-${crypto.randomUUID()}`,
			createdAt: now,
		});
		await database.db.insert(member).values({
			id: crypto.randomUUID(),
			organizationId: "workspace_test",
			userId: "user_assigned",
			role: "viewer",
			createdAt: now,
		});

		const repository = database.repositories.notificationInbox;
		const taskId = crypto.randomUUID();
		await database.db.insert(tasks).values({
			id: taskId,
			userId: "user_assigned",
			workspaceId: "workspace_test",
			assigneeId: "user_assigned",
			title: "Review the launch plan",
			createdAt: now.toISOString(),
			updatedAt: now.toISOString(),
		});
		const candidate = {
			userId: "user_assigned",
			workspaceId: "workspace_test",
			entityVersion: "user_assigned:2026-07-25T12:00:00.000Z",
			taskId,
			title: "Review the launch plan",
			assignedByUserId: "user_manager",
			assignedByName: "Manager",
			pageId: null,
			sourceBlockId: null,
		};

		const created = await repository.createTaskAssigned(
			candidate,
			"2026-07-25T12:00:00.000Z",
		);
		const duplicate = await repository.createTaskAssigned(
			candidate,
			"2026-07-25T12:00:01.000Z",
		);

		expect(created).toMatchObject({
			kind: "task.assigned",
			entityId: taskId,
			payload: {
				title: "Review the launch plan",
				assignedByUserId: "user_manager",
				assignedByName: "Manager",
			},
		});
		expect(duplicate).toBeNull();

		const viewerNotification = await repository.listByUser("user_assigned", {
			limit: 10,
		});
		expect(viewerNotification.items).toHaveLength(1);
		expect(viewerNotification.items[0]).toMatchObject({
			id: created?.id,
			taskAvailable: true,
			taskCanComplete: false,
		});

		await database.db
			.update(member)
			.set({ role: "member" })
			.where(eq(member.userId, "user_assigned"));
		expect(
			(await repository.listByUser("user_assigned", { limit: 10 })).items[0],
		).toMatchObject({
			id: created?.id,
			taskCanComplete: true,
		});

		await database.db
			.update(tasks)
			.set({ assigneeId: "user_replacement" })
			.where(eq(tasks.id, taskId));
		expect(
			(await repository.listByUser("user_assigned", { limit: 10 })).items,
		).toEqual([]);
		if (!created) throw new Error("Expected assignment notification");
		expect(
			await repository.findByUser("user_assigned", created.id),
		).toMatchObject({
			taskAssigneeId: "user_replacement",
			taskAvailable: false,
		});
	});
});

describe("task reminder persistence", () => {
	it("deduplicates a reminder and suppresses the matching overdue fallback", async () => {
		database = await createTestDatabase();
		const now = new Date("2026-07-09T12:00:00.000Z");
		await database.db.insert(user).values({
			id: "user_reminded",
			name: "Reminded User",
			email: "reminded@example.com",
			createdAt: now,
			updatedAt: now,
		});
		await database.db.insert(organization).values({
			id: "workspace_reminders",
			name: "Reminder workspace",
			slug: `reminders-${crypto.randomUUID()}`,
			createdAt: now,
		});
		await database.db.insert(member).values({
			id: crypto.randomUUID(),
			organizationId: "workspace_reminders",
			userId: "user_reminded",
			role: "member",
			createdAt: now,
		});
		const taskId = crypto.randomUUID();
		await database.db.insert(tasks).values({
			id: taskId,
			userId: "user_reminded",
			workspaceId: "workspace_reminders",
			assigneeId: "user_reminded",
			title: "Send the update",
			dueDate: "2026-07-09",
			dueTime: "10:00",
			reminderOffsetMinutes: 60,
			reminderConfiguredAt: now.toISOString(),
			createdAt: now.toISOString(),
			updatedAt: now.toISOString(),
		});
		const laterTaskId = crypto.randomUUID();
		await database.db.insert(tasks).values({
			id: laterTaskId,
			userId: "user_reminded",
			workspaceId: "workspace_reminders",
			assigneeId: "user_reminded",
			title: "Send the follow-up",
			dueDate: "2026-07-09",
			dueTime: "11:30",
			reminderOffsetMinutes: 60,
			reminderConfiguredAt: now.toISOString(),
			createdAt: "2026-07-09T12:00:01.000Z",
			updatedAt: "2026-07-09T12:00:01.000Z",
		});

		const repository = database.repositories.notificationInbox;
		expect(
			(
				await repository.findReminderCandidates({
					fromDate: "2026-07-10",
					cutoffDate: "2026-07-11",
					limit: 10,
				})
			).items,
		).toEqual([]);
		const firstPage = await repository.findReminderCandidates({
			fromDate: "2026-07-08",
			cutoffDate: "2026-07-11",
			limit: 1,
		});
		expect(firstPage.items.map((item) => item.taskId)).toEqual([taskId]);
		expect(firstPage.nextCursor).not.toBeNull();
		const secondPage = await repository.findReminderCandidates({
			fromDate: "2026-07-08",
			cutoffDate: "2026-07-11",
			limit: 1,
			cursor: firstPage.nextCursor ?? undefined,
		});
		expect(secondPage.items.map((item) => item.taskId)).toEqual([laterTaskId]);
		await database.db
			.update(tasks)
			.set({ completed: true })
			.where(eq(tasks.id, laterTaskId));

		const [candidate] = (
			await repository.findReminderCandidates({
				fromDate: "2026-07-08",
				cutoffDate: "2026-07-11",
				limit: 10,
			})
		).items;
		expect(candidate).toBeDefined();
		if (!candidate) throw new Error("Expected a reminder candidate");

		await database.db
			.update(tasks)
			.set({ completed: true })
			.where(eq(tasks.id, taskId));
		expect(
			await repository.createTaskReminder(
				candidate,
				"2026-07-09T14:00:00.000Z",
			),
		).toBeNull();

		await database.db
			.update(tasks)
			.set({ completed: false, dueTime: "11:00" })
			.where(eq(tasks.id, taskId));
		expect(
			await repository.createTaskReminder(
				candidate,
				"2026-07-09T14:00:01.000Z",
			),
		).toBeNull();

		await database.db
			.update(tasks)
			.set({ dueTime: "10:00" })
			.where(eq(tasks.id, taskId));
		const [freshCandidate] = (
			await repository.findReminderCandidates({
				fromDate: "2026-07-08",
				cutoffDate: "2026-07-11",
				limit: 10,
			})
		).items;
		if (!freshCandidate) throw new Error("Expected a fresh reminder candidate");
		await database.db.insert(notificationPreferences).values({
			userId: "user_reminded",
			taskRemindersEnabled: false,
			timezone: "UTC",
			timezoneConfigured: true,
			createdAt: now.toISOString(),
			updatedAt: now.toISOString(),
		});
		expect(
			await repository.createTaskReminder(
				freshCandidate,
				"2026-07-09T14:00:00.000Z",
			),
		).toBeNull();
		await database.db
			.update(notificationPreferences)
			.set({ taskRemindersEnabled: true })
			.where(eq(notificationPreferences.userId, "user_reminded"));
		const created = await repository.createTaskReminder(
			freshCandidate,
			"2026-07-09T14:00:00.000Z",
		);
		const duplicate = await repository.createTaskReminder(
			freshCandidate,
			"2026-07-09T14:00:01.000Z",
		);
		expect(created?.kind).toBe("task.reminder");
		expect(duplicate).toBeNull();
		expect(await repository.findOverdueCandidates("2026-07-11", 10)).toEqual(
			[],
		);

		if (!created) throw new Error("Expected a persisted reminder");
		expect(await repository.listValidReminderPush([created.id])).toEqual([
			created.id,
		]);
		await database.db
			.update(tasks)
			.set({ completed: true })
			.where(eq(tasks.id, taskId));
		expect(await repository.listValidReminderPush([created.id])).toEqual([]);
	});

	it("hides snoozed reminders and atomically re-arms them when due", async () => {
		database = await createTestDatabase();
		const now = new Date("2026-07-28T14:00:00.000Z");
		await database.db.insert(user).values({
			id: "user_snooze",
			name: "Snooze User",
			email: "snooze@example.com",
			createdAt: now,
			updatedAt: now,
		});
		await database.db.insert(organization).values({
			id: "workspace_snooze",
			name: "Snooze workspace",
			slug: `snooze-${crypto.randomUUID()}`,
			createdAt: now,
		});
		await database.db.insert(member).values({
			id: crypto.randomUUID(),
			organizationId: "workspace_snooze",
			userId: "user_snooze",
			role: "member",
			createdAt: now,
		});
		const taskId = crypto.randomUUID();
		await database.db.insert(tasks).values({
			id: taskId,
			userId: "user_snooze",
			workspaceId: "workspace_snooze",
			assigneeId: "user_snooze",
			title: "Review the draft",
			dueDate: "2026-07-28",
			dueTime: "16:00",
			reminderOffsetMinutes: 60,
			reminderConfiguredAt: now.toISOString(),
			createdAt: now.toISOString(),
			updatedAt: now.toISOString(),
		});

		const repository = database.repositories.notificationInbox;
		const [candidate] = (
			await repository.findReminderCandidates({
				fromDate: "2026-07-28",
				cutoffDate: "2026-07-28",
				limit: 10,
			})
		).items;
		if (!candidate) throw new Error("Expected a reminder candidate");
		const notification = await repository.createTaskReminder(
			candidate,
			now.toISOString(),
		);
		if (!notification) throw new Error("Expected a reminder notification");

		const snoozedUntil = "2026-07-28T15:00:00.000Z";
		expect(
			await repository.snooze(
				"user_snooze",
				notification.id,
				snoozedUntil,
				now.toISOString(),
			),
		).toBe(true);
		expect(
			(await repository.listByUser("user_snooze", { limit: 10 })).items,
		).toEqual([]);
		expect(await repository.countUnread("user_snooze")).toBe(0);
		expect(
			await repository.rearmDueSnoozes("2026-07-28T14:59:59.000Z", 10),
		).toBe(0);
		expect(
			await repository.rearmDueSnoozes("2026-07-28T15:00:00.000Z", 10),
		).toBe(1);

		const rearmed = await repository.listByUser("user_snooze", { limit: 10 });
		expect(rearmed.items).toHaveLength(1);
		expect(rearmed.items[0]).toMatchObject({
			id: notification.id,
			actionState: null,
			readAt: null,
			payload: { title: "Review the draft", rearmed: true },
		});
		expect(await repository.countUnread("user_snooze")).toBe(1);

		await repository.resolveTaskNotifications(
			taskId,
			"completed",
			"2026-07-28T15:01:00.000Z",
		);
		const completed = await repository.listByUser("user_snooze", {
			limit: 10,
		});
		expect(completed.items[0]).toMatchObject({
			actionState: "completed",
			readAt: "2026-07-28T15:01:00.000Z",
		});
		expect(await repository.countUnread("user_snooze")).toBe(0);
	});

	it("hides active overdue notifications after the task is rescheduled", async () => {
		database = await createTestDatabase();
		const now = new Date("2026-07-28T14:00:00.000Z");
		await database.db.insert(user).values({
			id: "user_rescheduled",
			name: "Rescheduled User",
			email: "rescheduled@example.com",
			createdAt: now,
			updatedAt: now,
		});
		await database.db.insert(organization).values({
			id: "workspace_rescheduled",
			name: "Rescheduled workspace",
			slug: `rescheduled-${crypto.randomUUID()}`,
			createdAt: now,
		});
		await database.db.insert(member).values({
			id: crypto.randomUUID(),
			organizationId: "workspace_rescheduled",
			userId: "user_rescheduled",
			role: "member",
			createdAt: now,
		});
		const taskId = crypto.randomUUID();
		await database.db.insert(tasks).values({
			id: taskId,
			userId: "user_rescheduled",
			workspaceId: "workspace_rescheduled",
			assigneeId: "user_rescheduled",
			title: "Take down the birdhouse",
			dueDate: "2026-07-18",
			dueTime: "12:00",
			createdAt: now.toISOString(),
			updatedAt: now.toISOString(),
		});

		const repository = database.repositories.notificationInbox;
		const created = await repository.createOverdue(
			{
				taskId,
				userId: "user_rescheduled",
				workspaceId: "workspace_rescheduled",
				title: "Take down the birdhouse",
				dueDate: "2026-07-18",
				dueTime: "12:00",
				pageId: null,
				sourceBlockId: null,
				timezone: "UTC",
			},
			now.toISOString(),
		);
		expect(created).not.toBeNull();
		expect(
			(await repository.listByUser("user_rescheduled", { limit: 10 })).items,
		).toHaveLength(1);

		await database.db
			.update(tasks)
			.set({
				dueDate: "2026-08-01",
				dueTime: "12:00",
				updatedAt: "2026-07-28T14:01:00.000Z",
			})
			.where(eq(tasks.id, taskId));

		expect(
			(await repository.listByUser("user_rescheduled", { limit: 10 })).items,
		).toEqual([]);
		expect(await repository.countUnread("user_rescheduled")).toBe(0);
		expect(
			await repository.listPendingPush("2026-07-28T14:01:00.000Z", 10),
		).toEqual([]);
	});

	it("allows an overdue alert after a snoozed reminder window has passed", async () => {
		database = await createTestDatabase();
		const now = new Date("2026-07-28T14:00:00.000Z");
		await database.db.insert(user).values({
			id: "user_late_snooze",
			name: "Late Snooze User",
			email: "late-snooze@example.com",
			createdAt: now,
			updatedAt: now,
		});
		await database.db.insert(organization).values({
			id: "workspace_late_snooze",
			name: "Late snooze workspace",
			slug: `late-snooze-${crypto.randomUUID()}`,
			createdAt: now,
		});
		await database.db.insert(member).values({
			id: crypto.randomUUID(),
			organizationId: "workspace_late_snooze",
			userId: "user_late_snooze",
			role: "member",
			createdAt: now,
		});
		const taskId = crypto.randomUUID();
		await database.db.insert(tasks).values({
			id: taskId,
			userId: "user_late_snooze",
			workspaceId: "workspace_late_snooze",
			assigneeId: "user_late_snooze",
			title: "Review the draft",
			dueDate: "2026-07-28",
			dueTime: "14:10",
			reminderOffsetMinutes: 15,
			reminderConfiguredAt: "2026-07-28T13:00:00.000Z",
			createdAt: now.toISOString(),
			updatedAt: now.toISOString(),
		});

		const repository = database.repositories.notificationInbox;
		const [candidate] = (
			await repository.findReminderCandidates({
				fromDate: "2026-07-28",
				cutoffDate: "2026-07-28",
				limit: 10,
			})
		).items;
		if (!candidate) throw new Error("Expected a reminder candidate");
		const notification = await repository.createTaskReminder(
			candidate,
			now.toISOString(),
		);
		if (!notification) throw new Error("Expected a reminder notification");
		expect(
			await repository.snooze(
				"user_late_snooze",
				notification.id,
				"2026-07-28T15:00:00.000Z",
				now.toISOString(),
			),
		).toBe(true);

		expect(
			await repository.rearmDueSnoozes("2026-07-28T15:00:00.000Z", 10),
		).toBe(0);
		const [stored] = await database.db
			.select({ actionState: notifications.actionState })
			.from(notifications)
			.where(eq(notifications.id, notification.id));
		expect(stored?.actionState).toBe("dismissed");
		expect(
			(await repository.listByUser("user_late_snooze", { limit: 10 })).items,
		).toEqual([]);
		expect(await repository.findOverdueCandidates("2026-07-29", 10)).toEqual([
			expect.objectContaining({
				taskId,
				userId: "user_late_snooze",
				workspaceId: "workspace_late_snooze",
			}),
		]);
	});
});

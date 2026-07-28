import { describe, expect, it } from "bun:test";
import type { AppContext } from "@/app-context";
import type {
	OverdueTaskCandidate,
	PendingPushNotification,
} from "@/features/notifications/ports";
import {
	isValidTimezone,
	type Notification,
	NotificationSchema,
} from "@/features/notifications/schemas";
import { processOverdueNotifications } from "@/features/tasks/schedules/check-overdue";
import { localDateAndHour } from "@/lib/timezone";

const USER_ID = "user_test";
const WORKSPACE_ID = "workspace_test";

function candidate(
	overrides: Partial<OverdueTaskCandidate> = {},
): OverdueTaskCandidate {
	return {
		taskId: crypto.randomUUID(),
		title: "Finish the notification system",
		dueDate: "2026-07-09",
		dueTime: null,
		pageId: null,
		sourceBlockId: null,
		userId: USER_ID,
		workspaceId: WORKSPACE_ID,
		timezone: "America/Chicago",
		...overrides,
	};
}

function createScheduleFixture(
	candidates: OverdueTaskCandidate[],
	options: {
		deliveryError?: (payload: unknown) => Error | null;
		pending?: PendingPushNotification[];
	} = {},
) {
	const createdKeys = new Set<string>();
	const pending: PendingPushNotification[] = [...(options.pending ?? [])];
	const deliveries: unknown[] = [];
	const notificationInbox = {
		async findReminderCandidates() {
			return { items: [], nextCursor: null };
		},
		async createTaskReminder() {
			return null;
		},
		async findOverdueCandidates() {
			return candidates;
		},
		async createOverdue(item: OverdueTaskCandidate, createdAt: string) {
			const version = item.dueTime
				? `${item.dueDate}:${item.dueTime}:${item.userId}`
				: `${item.dueDate}:${item.userId}`;
			const key = `${item.taskId}:${version}`;
			if (createdKeys.has(key)) return null;
			createdKeys.add(key);
			const notification: Notification = {
				id: crypto.randomUUID(),
				userId: item.userId,
				workspaceId: item.workspaceId,
				kind: "task.overdue",
				entityId: item.taskId,
				entityVersion: version,
				payload: {
					taskId: item.taskId,
					title: item.title,
					dueDate: item.dueDate,
					dueTime: item.dueTime,
					pageId: item.pageId,
					sourceBlockId: item.sourceBlockId,
				},
				readAt: null,
				createdAt,
			};
			pending.push({ ...notification, pushAttempts: 0 });
			return notification;
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
					const error = options.deliveryError?.(payload);
					if (error) throw error;
					return {
						notificationName: "tasks.overdue",
						payload,
						channels: ["push"],
						results: [],
					};
				},
			},
		},
	} as unknown as AppContext;

	return { ctx, createdKeys, deliveries };
}

function pendingAssignment(): PendingPushNotification {
	const taskId = crypto.randomUUID();
	return {
		id: crypto.randomUUID(),
		userId: "user_assigned",
		workspaceId: WORKSPACE_ID,
		kind: "task.assigned",
		entityId: taskId,
		entityVersion: `user_assigned:${crypto.randomUUID()}`,
		payload: {
			taskId,
			title: "Review the brief",
			assignedByUserId: "user_manager",
			assignedByName: "Manager",
			pageId: null,
			sourceBlockId: null,
		},
		readAt: null,
		createdAt: "2026-07-10T14:00:00.000Z",
		pushAttempts: 0,
	};
}

describe("overdue notification schedule", () => {
	it("keeps date-only notifications created before timed tasks were added", () => {
		const parsed = NotificationSchema.parse({
			id: crypto.randomUUID(),
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			kind: "task.overdue",
			entityId: crypto.randomUUID(),
			entityVersion: "2026-07-09:user_test",
			payload: {
				taskId: crypto.randomUUID(),
				title: "An existing notification",
				dueDate: "2026-07-09",
				pageId: null,
				sourceBlockId: null,
			},
			readAt: null,
			createdAt: "2026-07-10T14:00:00.000Z",
		});

		if (parsed.kind !== "task.overdue") {
			throw new Error("Expected an overdue notification");
		}
		expect(parsed.payload.dueTime).toBeNull();
	});

	it("uses the assignee timezone for the local date and hour", () => {
		expect(
			localDateAndHour(new Date("2026-07-10T14:00:00.000Z"), "America/Chicago"),
		).toEqual({ date: "2026-07-10", hour: 9 });
		expect(
			localDateAndHour(
				new Date("2026-07-09T23:00:00.000Z"),
				"Pacific/Kiritimati",
			),
		).toEqual({ date: "2026-07-10", hour: 13 });
	});

	it("creates one notification after 9 AM on the day after it was due", async () => {
		const fixture = createScheduleFixture([candidate()]);
		const first = await processOverdueNotifications(
			fixture.ctx,
			new Date("2026-07-10T14:00:00.000Z"),
		);
		const duplicate = await processOverdueNotifications(
			fixture.ctx,
			new Date("2026-07-10T15:00:00.000Z"),
		);

		expect(first.created).toBe(1);
		expect(duplicate.created).toBe(0);
		expect(fixture.createdKeys.size).toBe(1);
		expect(fixture.deliveries.length).toBeGreaterThan(0);
	});

	it("waits until 9 AM and never treats a task due today as overdue", async () => {
		const beforeNine = createScheduleFixture([candidate()]);
		const beforeResult = await processOverdueNotifications(
			beforeNine.ctx,
			new Date("2026-07-10T13:00:00.000Z"),
		);
		expect(beforeResult.created).toBe(0);

		const dueToday = createScheduleFixture([
			candidate({ dueDate: "2026-07-10" }),
		]);
		const todayResult = await processOverdueNotifications(
			dueToday.ctx,
			new Date("2026-07-10T18:00:00.000Z"),
		);
		expect(todayResult.created).toBe(0);
	});

	it("treats a timed task as overdue when its local due time passes", async () => {
		const fixture = createScheduleFixture([
			candidate({ dueDate: "2026-07-10", dueTime: "10:00" }),
		]);

		const before = await processOverdueNotifications(
			fixture.ctx,
			new Date("2026-07-10T14:55:00.000Z"),
		);
		const atDueTime = await processOverdueNotifications(
			fixture.ctx,
			new Date("2026-07-10T15:00:00.000Z"),
		);

		expect(before.created).toBe(0);
		expect(atDueTime.created).toBe(1);
	});

	it("attempts every delivery group before reporting failures", async () => {
		const fixture = createScheduleFixture(
			[
				candidate({ userId: "user_failing", workspaceId: "workspace_a" }),
				candidate({ userId: "user_delivered", workspaceId: "workspace_b" }),
			],
			{
				deliveryError(payload) {
					return (payload as { userId: string }).userId === "user_failing"
						? new Error("Push provider unavailable")
						: null;
				},
			},
		);

		let failure: unknown;
		try {
			await processOverdueNotifications(
				fixture.ctx,
				new Date("2026-07-10T14:00:00.000Z"),
			);
		} catch (error) {
			failure = error;
		}

		expect(failure).toBeInstanceOf(AggregateError);
		expect(
			fixture.deliveries.map(
				(delivery) => (delivery as { userId: string }).userId,
			),
		).toEqual(["user_failing", "user_delivered"]);
	});

	it("recovers assignment and overdue pushes without mixing their payloads", async () => {
		const fixture = createScheduleFixture([candidate()], {
			pending: [pendingAssignment()],
		});

		const result = await processOverdueNotifications(
			fixture.ctx,
			new Date("2026-07-10T14:00:00.000Z"),
		);

		expect(result.deliveryGroups).toBe(2);
		expect(fixture.deliveries).toHaveLength(2);
		const assignmentDelivery = fixture.deliveries.find(
			(delivery) => (delivery as { userId: string }).userId === "user_assigned",
		) as { items: Array<Record<string, unknown>> } | undefined;
		expect(assignmentDelivery?.items[0]).toMatchObject({
			title: "Review the brief",
			assignedByName: "Manager",
		});
		expect(assignmentDelivery?.items[0]).not.toHaveProperty("dueDate");
	});

	it("validates IANA timezones", () => {
		expect(isValidTimezone("America/Chicago")).toBe(true);
		expect(isValidTimezone("not/a-timezone")).toBe(false);
	});
});

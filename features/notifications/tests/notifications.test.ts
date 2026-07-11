import { describe, expect, it } from "bun:test";
import type { AppContext } from "@/app-context";
import type {
	OverdueTaskCandidate,
	PendingPushNotification,
} from "@/features/notifications/ports";
import type { Notification } from "@/features/notifications/schemas";
import { isValidTimezone } from "@/features/notifications/schemas";
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
	} = {},
) {
	const createdKeys = new Set<string>();
	const pending: PendingPushNotification[] = [];
	const deliveries: unknown[] = [];
	const notificationInbox = {
		async findOverdueCandidates() {
			return candidates;
		},
		async createOverdue(item: OverdueTaskCandidate, createdAt: string) {
			const key = `${item.taskId}:${item.dueDate}:${item.userId}`;
			if (createdKeys.has(key)) return null;
			createdKeys.add(key);
			const notification: Notification = {
				id: crypto.randomUUID(),
				userId: item.userId,
				workspaceId: item.workspaceId,
				kind: "task.overdue",
				entityId: item.taskId,
				entityVersion: `${item.dueDate}:${item.userId}`,
				payload: {
					taskId: item.taskId,
					title: item.title,
					dueDate: item.dueDate,
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

describe("overdue notification schedule", () => {
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

	it("validates IANA timezones", () => {
		expect(isValidTimezone("America/Chicago")).toBe(true);
		expect(isValidTimezone("not/a-timezone")).toBe(false);
	});
});

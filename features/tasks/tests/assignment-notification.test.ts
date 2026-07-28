import { describe, expect, it } from "bun:test";
import {
	createInlineNotificationDispatcher,
	type NotificationPreferencesPort,
} from "@beignet/core/notifications";
import type { AppContext } from "@/app-context";
import type {
	NotificationRepository,
	PendingPushNotification,
	StoredPushSubscription,
} from "@/features/notifications/ports";
import {
	createTaskAssignmentNotification,
	deliverTaskAssignmentNotifications,
	scheduleTaskAssignmentDelivery,
	TaskAssignedNotification,
} from "@/features/tasks/notifications/assigned";
import type { Task } from "@/features/tasks/schemas";
import { notificationPreferences } from "@/server/notification-preferences";

const notificationId = crypto.randomUUID();

function payload() {
	return {
		userId: "user_assigned",
		workspaceId: "workspace_test",
		notificationIds: [notificationId],
		attempt: 1,
		items: [
			{
				taskId: crypto.randomUUID(),
				title: "Review the brief",
				assignedByUserId: "user_manager",
				assignedByName: "Manager",
				pageId: null,
				sourceBlockId: null,
			},
		],
	};
}

describe("task assignment push channel", () => {
	it("defers immediate delivery until after the response", async () => {
		const scheduled: Array<() => Promise<void>> = [];
		const deliveries: unknown[] = [];
		const taskId = crypto.randomUUID();
		const notification = {
			id: crypto.randomUUID(),
			userId: "user_assigned",
			workspaceId: "workspace_test",
			kind: "task.assigned",
			entityId: taskId,
			entityVersion: "assignment_event",
			payload: {
				taskId,
				title: "Review the brief",
				assignedByUserId: "user_manager",
				assignedByName: "Manager",
				pageId: null,
				sourceBlockId: null,
			},
			readAt: null,
			createdAt: new Date().toISOString(),
		} as const;
		const ctx = {
			ports: {
				afterResponse: {
					schedule(work: () => Promise<void>) {
						scheduled.push(work);
					},
				},
				logger: { warn() {} },
				notifications: {
					async send(_definition: unknown, delivery: unknown) {
						deliveries.push(delivery);
						return {
							notificationName: "tasks.assigned",
							payload: delivery,
							channels: ["push"],
							results: [],
						};
					},
				},
			},
		} as unknown as AppContext;

		scheduleTaskAssignmentDelivery(ctx, [notification]);

		expect(scheduled).toHaveLength(1);
		expect(deliveries).toHaveLength(0);
		await scheduled[0]?.();
		expect(deliveries).toHaveLength(1);
	});

	it("keeps different retry counts in separate delivery groups", async () => {
		const deliveries: Array<{ attempt: number; notificationIds: string[] }> =
			[];
		const createPending = (pushAttempts: number): PendingPushNotification => {
			const taskId = crypto.randomUUID();
			return {
				id: crypto.randomUUID(),
				userId: "user_assigned",
				workspaceId: "workspace_test",
				kind: "task.assigned",
				entityId: taskId,
				entityVersion: `assignment_${pushAttempts}`,
				payload: {
					taskId,
					title: `Attempt ${pushAttempts}`,
					assignedByUserId: "user_manager",
					assignedByName: "Manager",
					pageId: null,
					sourceBlockId: null,
				},
				readAt: null,
				createdAt: new Date().toISOString(),
				pushAttempts,
			};
		};
		const ctx = {
			ports: {
				notifications: {
					async send(
						_definition: unknown,
						delivery: { attempt: number; notificationIds: string[] },
					) {
						deliveries.push(delivery);
						return {
							notificationName: "tasks.assigned",
							payload: delivery,
							channels: ["push"],
							results: [],
						};
					},
				},
			},
		} as unknown as AppContext;

		const retriedOnce = createPending(1);
		const retriedTwice = createPending(2);
		await deliverTaskAssignmentNotifications(ctx, [retriedOnce, retriedTwice]);

		expect(
			deliveries.map(({ attempt, notificationIds }) => ({
				attempt,
				notificationIds,
			})),
		).toEqual([
			{ attempt: 2, notificationIds: [retriedOnce.id] },
			{ attempt: 3, notificationIds: [retriedTwice.id] },
		]);
	});

	it("does not create an inbox notification when the preference is disabled", async () => {
		const task: Task = {
			id: crypto.randomUUID(),
			userId: "user_manager",
			workspaceId: "workspace_test",
			pageId: null,
			sourceBlockId: null,
			title: "Review the brief",
			completed: false,
			dueDate: null,
			dueTime: null,
			reminderOffsetMinutes: null,
			assigneeId: "user_assigned",
			completedAt: null,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		let created = false;
		const notificationInbox = {
			async getPreferences() {
				return {
					overdueTasksEnabled: true,
					taskAssignmentsEnabled: false,
					timezone: "UTC",
					timezoneConfigured: true,
				};
			},
			async createTaskAssigned() {
				created = true;
				return null;
			},
		} as unknown as NotificationRepository;

		const notification = await createTaskAssignmentNotification(
			notificationInbox,
			task,
			null,
			{ userId: "user_manager", name: "Manager" },
		);

		expect(notification).toBeNull();
		expect(created).toBe(false);
	});

	it("skips disabled assignment notifications through preferences", async () => {
		const skipped: string[][] = [];
		const ctx = {
			ports: {
				notificationInbox: {
					async getPreferences() {
						return {
							overdueTasksEnabled: true,
							taskAssignmentsEnabled: false,
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

		const result = await notifications.send(
			TaskAssignedNotification,
			payload(),
		);

		expect(result.results).toEqual([
			{
				channel: "push",
				status: "skipped",
				reason: "Task assignment notifications are disabled.",
				details: { source: "preferences" },
			},
		]);
		expect(skipped).toEqual([[notificationId]]);
	});

	it("delivers assignment copy and completes the claimed notification", async () => {
		const subscription: StoredPushSubscription = {
			id: crypto.randomUUID(),
			userId: "user_assigned",
			endpoint: "https://push.example.com/subscription",
			expirationTime: null,
			keys: { p256dh: "key", auth: "auth" },
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		const sent: Array<{ title: string; body: string; url: string }> = [];
		const delivered: string[][] = [];
		const ctx = {
			ports: {
				notificationInbox: {
					async listPushSubscriptions() {
						return [subscription];
					},
					async claimPush() {
						return true;
					},
					async countUnread() {
						return 1;
					},
					async deletePushSubscription() {},
					async markPushDelivered(ids: string[]) {
						delivered.push(ids);
					},
				},
				webPush: {
					isConfigured: () => true,
					async send(
						_subscription: StoredPushSubscription,
						message: { title: string; body: string; url: string },
					) {
						sent.push(message);
						return { status: "sent" as const };
					},
				},
			},
		} as unknown as AppContext;

		const result = await TaskAssignedNotification.channels.push({
			notification: TaskAssignedNotification,
			payload: payload(),
			ctx,
			channel: "push",
		});

		expect(result?.status).toBe("sent");
		expect(sent).toEqual([
			expect.objectContaining({
				title: "Manager assigned you a task",
				body: "Review the brief",
				url: "/w/workspace_test/tasks?scope=mine",
			}),
		]);
		expect(delivered).toEqual([[notificationId]]);
	});
});

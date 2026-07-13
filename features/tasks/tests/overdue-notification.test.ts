import { describe, expect, it } from "bun:test";
import {
	createInlineNotificationDispatcher,
	type NotificationPreferencesPort,
} from "@beignet/core/notifications";
import type { AppContext } from "@/app-context";
import type { StoredPushSubscription } from "@/features/notifications/ports";
import { TaskOverdueNotification } from "@/features/tasks/notifications/overdue";
import { notificationPreferences } from "@/server/notification-preferences";

const notificationId = crypto.randomUUID();
const taskId = crypto.randomUUID();

function payload() {
	return {
		userId: "user_test",
		workspaceId: "workspace_test",
		notificationIds: [notificationId],
		attempt: 1,
		items: [
			{
				taskId,
				title: "Ship it",
				dueDate: "2026-07-08",
				dueTime: null,
				pageId: null,
				sourceBlockId: null,
			},
		],
	};
}

describe("task overdue push channel", () => {
	it("skips disabled notifications through the app preference evaluator", async () => {
		const skipped: string[][] = [];
		const ctx = {
			ports: {
				notificationInbox: {
					async getPreferences() {
						return { overdueTasksEnabled: false, timezone: "UTC" };
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

		const result = await notifications.send(TaskOverdueNotification, payload());

		expect(result.results).toEqual([
			{
				channel: "push",
				status: "skipped",
				reason: "Overdue notifications are disabled.",
				details: { source: "preferences" },
			},
		]);
		expect(skipped).toEqual([[notificationId]]);
	});

	it("skips delivery when the user has no subscribed device", async () => {
		const skipped: string[][] = [];
		const ctx = {
			ports: {
				notificationInbox: {
					async getPreferences() {
						return { overdueTasksEnabled: true, timezone: "UTC" };
					},
					async listPushSubscriptions() {
						return [];
					},
					async markPushSkipped(ids: string[]) {
						skipped.push(ids);
					},
				},
				webPush: { isConfigured: () => true },
			},
		} as unknown as AppContext;
		const result = await TaskOverdueNotification.channels.push({
			notification: TaskOverdueNotification,
			payload: payload(),
			ctx,
			channel: "push",
		});

		expect(result?.status).toBe("skipped");
		expect(skipped).toEqual([[notificationId]]);
	});

	it("delivers and completes a claimed push batch", async () => {
		const subscription: StoredPushSubscription = {
			id: crypto.randomUUID(),
			userId: "user_test",
			endpoint: "https://push.example.com/subscription",
			expirationTime: null,
			keys: { p256dh: "key", auth: "auth" },
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		const sent: unknown[] = [];
		const delivered: string[][] = [];
		const ctx = {
			ports: {
				notificationInbox: {
					async getPreferences() {
						return { overdueTasksEnabled: true, timezone: "UTC" };
					},
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
					async send(_subscription: StoredPushSubscription, message: unknown) {
						sent.push(message);
						return { status: "sent" as const };
					},
				},
			},
		} as unknown as AppContext;
		const result = await TaskOverdueNotification.channels.push({
			notification: TaskOverdueNotification,
			payload: payload(),
			ctx,
			channel: "push",
		});

		expect(result?.status).toBe("sent");
		expect(sent).toHaveLength(1);
		expect(delivered).toEqual([[notificationId]]);
	});

	it("reports a failed channel after recording its retry", async () => {
		const subscription: StoredPushSubscription = {
			id: crypto.randomUUID(),
			userId: "user_test",
			endpoint: "https://push.example.com/subscription",
			expirationTime: null,
			keys: { p256dh: "key", auth: "auth" },
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		const failed: Array<{ ids: string[]; retryAt: string | null }> = [];
		const ctx = {
			ports: {
				notificationInbox: {
					async getPreferences() {
						return { overdueTasksEnabled: true, timezone: "UTC" };
					},
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
					async markPushFailed(ids: string[], retryAt: string | null) {
						failed.push({ ids, retryAt });
					},
				},
				webPush: {
					isConfigured: () => true,
					async send() {
						return { status: "failed" as const };
					},
				},
			},
		} as unknown as AppContext;
		const result = await TaskOverdueNotification.channels.push({
			notification: TaskOverdueNotification,
			payload: payload(),
			ctx,
			channel: "push",
		});

		expect(result?.status).toBe("failed");
		expect(failed).toHaveLength(1);
		expect(failed[0]?.ids).toEqual([notificationId]);
		expect(failed[0]?.retryAt).not.toBeNull();
	});
});

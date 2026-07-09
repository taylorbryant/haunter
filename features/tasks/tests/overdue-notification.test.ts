import { describe, expect, it } from "bun:test";
import type { AppContext } from "@/app-context";
import type { StoredPushSubscription } from "@/features/notifications/ports";
import { TaskOverdueNotification } from "@/features/tasks/notifications/overdue";

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
				pageId: null,
				sourceBlockId: null,
			},
		],
	};
}

describe("task overdue push channel", () => {
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
});

import { z } from "zod";
import { TaskOverdueNotificationPayloadSchema } from "@/features/notifications/schemas";
import { defineNotification } from "@/lib/notifications";

export const TaskOverdueDeliveryPayloadSchema = z.object({
	userId: z.string(),
	workspaceId: z.string(),
	notificationIds: z.array(z.string().uuid()).min(1),
	attempt: z.number().int().min(1).max(3),
	items: z.array(TaskOverdueNotificationPayloadSchema).min(1),
});

export const TaskOverdueNotification = defineNotification("tasks.overdue", {
	payload: TaskOverdueDeliveryPayloadSchema,
	description: "Notifies an assignee about tasks that have become overdue.",
	channels: {
		push: async ({ payload, ctx, channel }) => {
			const ids = payload.notificationIds;
			const preferences = await ctx.ports.notificationInbox.getPreferences(
				payload.userId,
			);
			if (
				!preferences.overdueTasksEnabled ||
				!ctx.ports.webPush.isConfigured()
			) {
				await ctx.ports.notificationInbox.markPushSkipped(ids);
				return {
					channel,
					status: "skipped",
					reason: preferences.overdueTasksEnabled
						? "Web Push is not configured."
						: "Overdue notifications are disabled.",
				};
			}

			const subscriptions =
				await ctx.ports.notificationInbox.listPushSubscriptions(payload.userId);
			if (subscriptions.length === 0) {
				await ctx.ports.notificationInbox.markPushSkipped(ids);
				return {
					channel,
					status: "skipped",
					reason: "The user has no push subscriptions.",
				};
			}

			const leaseUntil = new Date(Date.now() + 10 * 60 * 1000).toISOString();
			if (!(await ctx.ports.notificationInbox.claimPush(ids, leaseUntil))) {
				return {
					channel,
					status: "skipped",
					reason: "Another schedule invocation claimed this delivery.",
				};
			}

			const count = payload.items.length;
			const only = payload.items[0];
			const title = count === 1 ? "Task overdue" : `${count} tasks overdue`;
			const body =
				count === 1 && only ? only.title : "Open Haunter to review them.";
			const url =
				count === 1 && only?.pageId
					? `/w/${payload.workspaceId}/p/${only.pageId}${
							only.sourceBlockId
								? `?block=${encodeURIComponent(only.sourceBlockId)}`
								: ""
						}`
					: `/w/${payload.workspaceId}/tasks?scope=mine`;
			const unreadCount = await ctx.ports.notificationInbox.countUnread(
				payload.userId,
			);

			const results = await Promise.all(
				subscriptions.map(async (subscription) => ({
					subscription,
					result: await ctx.ports.webPush.send(subscription, {
						title,
						body,
						url,
						tag: `tasks-overdue:${payload.userId}:${payload.workspaceId}`,
						unreadCount,
					}),
				})),
			);

			await Promise.all(
				results
					.filter(({ result }) => result.status === "gone")
					.map(({ subscription }) =>
						ctx.ports.notificationInbox.deletePushSubscription(
							payload.userId,
							subscription.endpoint,
						),
					),
			);

			const sent = results.filter(
				({ result }) => result.status === "sent",
			).length;
			if (sent > 0) {
				await ctx.ports.notificationInbox.markPushDelivered(
					ids,
					new Date().toISOString(),
				);
				return { channel, status: "sent", provider: "web-push" };
			}

			const retryAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
			const transientFailure = results.some(
				({ result }) => result.status === "failed",
			);
			if (transientFailure) {
				await ctx.ports.notificationInbox.markPushFailed(
					ids,
					payload.attempt >= 3 ? null : retryAt,
				);
				return {
					channel,
					status: "failed",
					reason: "Every active push delivery failed.",
				};
			}

			await ctx.ports.notificationInbox.markPushSkipped(ids);
			return {
				channel,
				status: "skipped",
				reason: "Every push subscription had expired.",
			};
		},
	},
});

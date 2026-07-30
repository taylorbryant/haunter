import { z } from "zod";
import type { AppContext } from "@/app-context";
import type { PendingPushNotification } from "@/features/notifications/ports";
import { TaskReminderNotificationPayloadSchema } from "@/features/notifications/schemas";
import { defineNotification } from "@/lib/notifications";
import { shouldCreateTaskReminder } from "../lib/reminder-time";

export {
	shouldCreateTaskReminder,
	zonedDateTimeToUtc,
} from "../lib/reminder-time";

const MINUTE_MS = 60_000;

export const TaskReminderDeliveryPayloadSchema = z.object({
	userId: z.string(),
	workspaceId: z.string(),
	notificationIds: z.array(z.string().uuid()).min(1),
	attempt: z.number().int().min(1).max(3),
	items: z.array(TaskReminderNotificationPayloadSchema).min(1),
});

function singleReminderTitle(
	item: z.infer<typeof TaskReminderNotificationPayloadSchema>,
) {
	if (item.rearmed) return "Task reminder";
	if (item.dueTime === null) {
		if (item.reminderOffsetMinutes === 1_440) return "Task due tomorrow";
		if (item.reminderOffsetMinutes === 0) return "Task due today";
		return "Task due soon";
	}
	switch (item.reminderOffsetMinutes) {
		case 0:
			return "Task due now";
		case 15:
			return "Task due in 15 minutes";
		case 60:
			return "Task due in 1 hour";
		case 1_440:
			return "Task due tomorrow";
	}
}

export const TaskReminderNotification = defineNotification("tasks.reminder", {
	payload: TaskReminderDeliveryPayloadSchema,
	description: "Reminds an assignee before a task is due.",
	channels: {
		push: async ({ payload, ctx, channel }) => {
			const ids = payload.notificationIds;
			if (!ctx.ports.webPush.isConfigured()) {
				await ctx.ports.notificationInbox.markPushSkipped(ids);
				return {
					channel,
					status: "skipped",
					reason: "Web Push is not configured.",
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

			const leaseUntil = new Date(Date.now() + 10 * MINUTE_MS).toISOString();
			if (!(await ctx.ports.notificationInbox.claimPush(ids, leaseUntil))) {
				return {
					channel,
					status: "skipped",
					reason: "Another schedule invocation claimed this delivery.",
				};
			}

			const count = payload.items.length;
			const only = payload.items[0];
			const title =
				count === 1 && only
					? singleReminderTitle(only)
					: `${count} task reminders`;
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
						tag: `tasks-reminder:${payload.userId}:${payload.workspaceId}`,
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

			if (results.some(({ result }) => result.status === "sent")) {
				await ctx.ports.notificationInbox.markPushDelivered(
					ids,
					new Date().toISOString(),
				);
				return { channel, status: "sent", provider: "web-push" };
			}

			if (results.some(({ result }) => result.status === "failed")) {
				const retryAt = new Date(Date.now() + 60 * MINUTE_MS).toISOString();
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

function groupReminders(items: PendingPushNotification[]) {
	const groups = new Map<string, PendingPushNotification[]>();
	for (const item of items) {
		if (item.kind !== "task.reminder") continue;
		const key = `${item.userId}:${item.workspaceId}:${item.pushAttempts}`;
		groups.set(key, [...(groups.get(key) ?? []), item]);
	}
	return groups.values();
}

export async function deliverTaskReminderNotifications(
	ctx: AppContext,
	items: PendingPushNotification[],
): Promise<number> {
	const reminderItems = items.filter((item) => item.kind === "task.reminder");
	if (reminderItems.length === 0) return 0;

	const validIds = new Set(
		await ctx.ports.notificationInbox.listValidReminderPush(
			reminderItems.map((item) => item.id),
		),
	);
	const staleIds = reminderItems
		.filter((item) => !validIds.has(item.id))
		.map((item) => item.id);
	await ctx.ports.notificationInbox.markPushSkipped(staleIds);

	let deliveryGroups = 0;
	const deliveryErrors: unknown[] = [];
	for (const group of groupReminders(
		reminderItems.filter((item) => validIds.has(item.id)),
	)) {
		const first = group[0];
		if (first?.kind !== "task.reminder") continue;
		deliveryGroups += 1;
		try {
			await ctx.ports.notifications.send(TaskReminderNotification, {
				userId: first.userId,
				workspaceId: first.workspaceId,
				notificationIds: group.map((item) => item.id),
				attempt: first.pushAttempts + 1,
				items: group.flatMap((item) =>
					item.kind === "task.reminder" ? [item.payload] : [],
				),
			});
		} catch (error) {
			deliveryErrors.push(error);
		}
	}
	if (deliveryErrors.length > 0) {
		throw new AggregateError(
			deliveryErrors,
			"One or more task reminder notification deliveries failed.",
		);
	}
	return deliveryGroups;
}

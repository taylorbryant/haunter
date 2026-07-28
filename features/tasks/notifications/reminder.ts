import { z } from "zod";
import type { AppContext } from "@/app-context";
import type {
	PendingPushNotification,
	TaskReminderCandidate,
} from "@/features/notifications/ports";
import { TaskReminderNotificationPayloadSchema } from "@/features/notifications/schemas";
import { defineNotification } from "@/lib/notifications";

const MINUTE_MS = 60_000;
const TIMED_REMINDER_GRACE_MS = 10 * MINUTE_MS;
const zonedFormatterByTimezone = new Map<string, Intl.DateTimeFormat>();

export const TaskReminderDeliveryPayloadSchema = z.object({
	userId: z.string(),
	workspaceId: z.string(),
	notificationIds: z.array(z.string().uuid()).min(1),
	attempt: z.number().int().min(1).max(3),
	items: z.array(TaskReminderNotificationPayloadSchema).min(1),
});

function readZonedParts(at: Date, timezone: string) {
	let formatter = zonedFormatterByTimezone.get(timezone);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat("en-CA", {
			timeZone: timezone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hourCycle: "h23",
		});
		zonedFormatterByTimezone.set(timezone, formatter);
	}
	const parts = formatter.formatToParts(at);
	const read = (type: Intl.DateTimeFormatPartTypes) =>
		Number(parts.find((part) => part.type === type)?.value ?? "0");
	return {
		year: read("year"),
		month: read("month"),
		day: read("day"),
		hour: read("hour"),
		minute: read("minute"),
		second: read("second"),
	};
}

function timezoneOffsetMs(at: Date, timezone: string) {
	const parts = readZonedParts(at, timezone);
	const representedAsUtc = Date.UTC(
		parts.year,
		parts.month - 1,
		parts.day,
		parts.hour,
		parts.minute,
		parts.second,
	);
	return representedAsUtc - Math.floor(at.getTime() / 1_000) * 1_000;
}

/**
 * Resolves an app-local date and time to an instant.
 *
 * Ambiguous times use the earlier occurrence. Nonexistent wall times advance
 * by the timezone transition gap (for example, 02:30 becomes 03:30 during a
 * one-hour spring-forward). Sampling the nearby offsets keeps this constant
 * time rather than searching minute by minute.
 */
export function zonedDateTimeToUtc(
	date: string,
	time: string,
	timezone: string,
): Date {
	const [year, month, day] = date.split("-").map(Number);
	const [hour, minute] = time.split(":").map(Number);
	const localAsUtc = Date.UTC(year, month - 1, day, hour, minute);
	const sampleDeltas = [
		-36 * 60 * MINUTE_MS,
		-12 * 60 * MINUTE_MS,
		0,
		12 * 60 * MINUTE_MS,
		36 * 60 * MINUTE_MS,
	];
	const offsets = new Set(
		sampleDeltas.map((delta) =>
			timezoneOffsetMs(new Date(localAsUtc + delta), timezone),
		),
	);
	const candidates = [...offsets].map((offset) => {
		const instant = new Date(localAsUtc - offset);
		const parts = readZonedParts(instant, timezone);
		const roundTrippedLocal = Date.UTC(
			parts.year,
			parts.month - 1,
			parts.day,
			parts.hour,
			parts.minute,
		);
		return { instant, roundTrippedLocal };
	});

	const exact = candidates
		.filter(({ roundTrippedLocal }) => roundTrippedLocal === localAsUtc)
		.sort((a, b) => a.instant.getTime() - b.instant.getTime());
	if (exact[0]) return exact[0].instant;

	const advanced = candidates
		.filter(({ roundTrippedLocal }) => roundTrippedLocal > localAsUtc)
		.sort(
			(a, b) =>
				a.roundTrippedLocal - b.roundTrippedLocal ||
				a.instant.getTime() - b.instant.getTime(),
		);
	if (advanced[0]) return advanced[0].instant;

	return new Date(Number.NaN);
}

function nextIsoDate(date: string) {
	const [year, month, day] = date.split("-").map(Number);
	const next = new Date(Date.UTC(year, month - 1, day + 1));
	return next.toISOString().slice(0, 10);
}

export function shouldCreateTaskReminder(
	candidate: TaskReminderCandidate,
	at: Date,
): boolean {
	const dueTime = candidate.dueTime ?? "09:00";
	const dueAt = zonedDateTimeToUtc(
		candidate.dueDate,
		dueTime,
		candidate.timezone,
	);
	const configuredAt = new Date(candidate.reminderConfiguredAt);
	if (
		!Number.isFinite(dueAt.getTime()) ||
		!Number.isFinite(configuredAt.getTime()) ||
		configuredAt.getTime() > dueAt.getTime()
	) {
		return false;
	}

	const targetAt = new Date(
		dueAt.getTime() - candidate.reminderOffsetMinutes * MINUTE_MS,
	);
	if (at.getTime() < targetAt.getTime()) return false;

	const deadlineAt = candidate.dueTime
		? new Date(dueAt.getTime() + TIMED_REMINDER_GRACE_MS)
		: zonedDateTimeToUtc(
				nextIsoDate(candidate.dueDate),
				"00:00",
				candidate.timezone,
			);
	return at.getTime() < deadlineAt.getTime();
}

function singleReminderTitle(
	item: z.infer<typeof TaskReminderNotificationPayloadSchema>,
) {
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

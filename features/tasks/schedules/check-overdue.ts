import { z } from "zod";
import type { AppContext } from "@/app-context";
import type { PendingPushNotification } from "@/features/notifications/ports";
import { deliverTaskAssignmentNotifications } from "@/features/tasks/notifications/assigned";
import { TaskOverdueNotification } from "@/features/tasks/notifications/overdue";
import {
	deliverTaskReminderNotifications,
	shouldCreateTaskReminder,
} from "@/features/tasks/notifications/reminder";
import { defineSchedule } from "@/lib/schedules";
import { localDateAndTime } from "@/lib/timezone";

export const CheckOverdueSchedulePayloadSchema = z.object({
	at: z.string().datetime(),
});

export type CheckOverdueSchedulePayload = z.infer<
	typeof CheckOverdueSchedulePayloadSchema
>;

const CANDIDATE_LIMIT = 5_000;
const REMINDER_CANDIDATE_PAGE_SIZE = 250;
const DELIVERY_LIMIT = 1_000;

function groupPending(items: PendingPushNotification[]) {
	const groups = new Map<string, PendingPushNotification[]>();
	for (const item of items) {
		if (item.kind !== "task.overdue") continue;
		const key = `${item.userId}:${item.workspaceId}:${item.pushAttempts}`;
		groups.set(key, [...(groups.get(key) ?? []), item]);
	}
	return groups.values();
}

export async function processOverdueNotifications(ctx: AppContext, at: Date) {
	// A one-day reminder can target a date that is already tomorrow in UTC+14.
	// Query from yesterday through two UTC dates ahead, then apply the exact
	// timezone-aware window. Keyset pagination scans the complete finite window
	// without letting an inactive prefix hide later actionable reminders.
	const reminderStart = new Date(at);
	reminderStart.setUTCDate(reminderStart.getUTCDate() - 1);
	const reminderCutoff = new Date(at);
	reminderCutoff.setUTCDate(reminderCutoff.getUTCDate() + 2);
	const reminderWindow = {
		fromDate: reminderStart.toISOString().slice(0, 10),
		cutoffDate: reminderCutoff.toISOString().slice(0, 10),
	};
	let reminderCursor:
		| {
				dueDate: string;
				dueTime: string;
				createdAt: string;
				taskId: string;
		  }
		| undefined;
	let reminderCandidates = 0;
	let remindersCreated = 0;
	do {
		const page = await ctx.ports.notificationInbox.findReminderCandidates({
			...reminderWindow,
			limit: REMINDER_CANDIDATE_PAGE_SIZE,
			cursor: reminderCursor,
		});
		reminderCandidates += page.items.length;
		for (const candidate of page.items) {
			if (!shouldCreateTaskReminder(candidate, at)) continue;
			if (
				await ctx.ports.notificationInbox.createTaskReminder(
					candidate,
					at.toISOString(),
				)
			) {
				remindersCreated += 1;
			}
		}
		reminderCursor = page.nextCursor ?? undefined;
	} while (reminderCursor);

	// UTC+14 may already be on the next date, so include today's UTC due dates
	// in the bounded candidate query and apply the exact local-date rule below.
	const cutoff = new Date(at);
	cutoff.setUTCDate(cutoff.getUTCDate() + 1);
	const cutoffDate = cutoff.toISOString().slice(0, 10);
	const candidates = await ctx.ports.notificationInbox.findOverdueCandidates(
		cutoffDate,
		CANDIDATE_LIMIT,
	);

	let created = 0;
	for (const candidate of candidates) {
		const local = localDateAndTime(at, candidate.timezone);
		const overdue = candidate.dueTime
			? candidate.dueDate < local.date ||
				(candidate.dueDate === local.date && candidate.dueTime <= local.time)
			: local.hour >= 9 && candidate.dueDate < local.date;
		if (!overdue) continue;
		if (
			await ctx.ports.notificationInbox.createOverdue(
				candidate,
				at.toISOString(),
			)
		) {
			created += 1;
		}
	}

	const pending = await ctx.ports.notificationInbox.listPendingPush(
		at.toISOString(),
		DELIVERY_LIMIT,
	);
	let deliveryGroups = 0;
	const deliveryErrors: unknown[] = [];
	for (const group of groupPending(pending)) {
		const first = group[0];
		if (first?.kind !== "task.overdue") continue;
		deliveryGroups += 1;
		try {
			await ctx.ports.notifications.send(TaskOverdueNotification, {
				userId: first.userId,
				workspaceId: first.workspaceId,
				notificationIds: group.map((item) => item.id),
				attempt: first.pushAttempts + 1,
				items: group.flatMap((item) =>
					item.kind === "task.overdue" ? [item.payload] : [],
				),
			});
		} catch (error) {
			deliveryErrors.push(error);
		}
	}
	const assignmentItems = pending.filter(
		(item) => item.kind === "task.assigned",
	);
	if (assignmentItems.length > 0) {
		try {
			deliveryGroups += await deliverTaskAssignmentNotifications(
				ctx,
				assignmentItems,
			);
		} catch (error) {
			deliveryErrors.push(error);
		}
	}
	const reminderItems = pending.filter((item) => item.kind === "task.reminder");
	if (reminderItems.length > 0) {
		try {
			deliveryGroups += await deliverTaskReminderNotifications(
				ctx,
				reminderItems,
			);
		} catch (error) {
			deliveryErrors.push(error);
		}
	}
	if (deliveryErrors.length > 0) {
		throw new AggregateError(
			deliveryErrors,
			`Failed to deliver ${deliveryErrors.length} notification group(s).`,
		);
	}

	return {
		candidates: candidates.length,
		created,
		reminderCandidates,
		remindersCreated,
		deliveryGroups,
	};
}

export const CheckOverdueSchedule = defineSchedule("tasks.check-overdue", {
	cron: "*/5 * * * *",
	timezone: "UTC",
	payload: CheckOverdueSchedulePayloadSchema,
	createPayload({ run }) {
		return { at: (run.scheduledAt ?? run.triggeredAt).toISOString() };
	},
	async handle({ payload, ctx }) {
		const result = await processOverdueNotifications(ctx, new Date(payload.at));
		ctx.ports.logger.info("Task notifications reconciled", {
			scheduleName: "tasks.check-overdue",
			...result,
		});
	},
});

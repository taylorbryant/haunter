import { z } from "zod";
import type { AppContext } from "@/app-context";
import type { PendingPushNotification } from "@/features/notifications/ports";
import { TaskOverdueNotification } from "@/features/tasks/notifications/overdue";
import { defineSchedule } from "@/lib/schedules";
import { localDateAndHour } from "@/lib/timezone";

export const CheckOverdueSchedulePayloadSchema = z.object({
	at: z.string().datetime(),
});

export type CheckOverdueSchedulePayload = z.infer<
	typeof CheckOverdueSchedulePayloadSchema
>;

const CANDIDATE_LIMIT = 5_000;
const DELIVERY_LIMIT = 1_000;

function groupPending(items: PendingPushNotification[]) {
	const groups = new Map<string, PendingPushNotification[]>();
	for (const item of items) {
		const key = `${item.userId}:${item.workspaceId}`;
		groups.set(key, [...(groups.get(key) ?? []), item]);
	}
	return groups.values();
}

export async function processOverdueNotifications(ctx: AppContext, at: Date) {
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
		const local = localDateAndHour(at, candidate.timezone);
		if (local.hour < 9 || candidate.dueDate >= local.date) continue;
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
	for (const group of groupPending(pending)) {
		const first = group[0];
		if (!first) continue;
		deliveryGroups += 1;
		await ctx.ports.notifications.send(TaskOverdueNotification, {
			userId: first.userId,
			workspaceId: first.workspaceId,
			notificationIds: group.map((item) => item.id),
			attempt: Math.max(...group.map((item) => item.pushAttempts)) + 1,
			items: group.map((item) => item.payload),
		});
	}

	return { candidates: candidates.length, created, deliveryGroups };
}

export const CheckOverdueSchedule = defineSchedule("tasks.check-overdue", {
	cron: "0 * * * *",
	timezone: "UTC",
	payload: CheckOverdueSchedulePayloadSchema,
	createPayload({ run }) {
		return { at: (run.scheduledAt ?? run.triggeredAt).toISOString() };
	},
	async handle({ payload, ctx }) {
		const result = await processOverdueNotifications(ctx, new Date(payload.at));
		ctx.ports.logger.info("Overdue task notifications reconciled", {
			scheduleName: "tasks.check-overdue",
			...result,
		});
	},
});

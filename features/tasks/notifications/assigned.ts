import type { NotificationPort } from "@beignet/core/notifications";
import type { LoggerPort, TenantScope } from "@beignet/core/ports";
import { z } from "zod";
import type { MemberRepository } from "@/features/members/ports";
import type { NotificationRepository } from "@/features/notifications/ports";
import {
	type Notification,
	TaskAssignedNotificationPayloadSchema,
} from "@/features/notifications/schemas";
import { defineNotification } from "@/lib/notifications";
import type { TaskAssignmentActor, TaskAssignmentDeliveryPort } from "../ports";
import type { Task } from "../schemas";

export const TaskAssignedDeliveryPayloadSchema = z.object({
	userId: z.string(),
	workspaceId: z.string(),
	notificationIds: z.array(z.string().uuid()).min(1),
	attempt: z.number().int().min(1).max(3),
	items: z.array(TaskAssignedNotificationPayloadSchema).min(1),
});

export type { TaskAssignmentActor } from "../ports";

export async function resolveTaskAssignmentActor(
	members: MemberRepository,
	scope: TenantScope,
	user: { id: string; name?: string | null; email?: string | null },
): Promise<TaskAssignmentActor> {
	const suppliedName = user.name?.trim() || user.email?.trim();
	if (suppliedName) return { userId: user.id, name: suppliedName };

	const member = (await members.listByWorkspace(scope)).find(
		(candidate) => candidate.userId === user.id,
	);
	return {
		userId: user.id,
		name: member?.name.trim() || member?.email || "A teammate",
	};
}

export async function createTaskAssignmentNotification(
	notificationInbox: NotificationRepository,
	task: Task,
	previousAssigneeId: string | null,
	actor: TaskAssignmentActor | undefined,
): Promise<Notification | null> {
	if (
		!actor ||
		task.completed ||
		task.assigneeId === null ||
		task.assigneeId === previousAssigneeId ||
		task.assigneeId === actor.userId
	) {
		return null;
	}

	const preferences = await notificationInbox.getPreferences(task.assigneeId);
	if (!preferences.taskAssignmentsEnabled) return null;

	return notificationInbox.createTaskAssigned(
		{
			userId: task.assigneeId,
			workspaceId: task.workspaceId,
			entityVersion: `${task.assigneeId}:${task.updatedAt}`,
			taskId: task.id,
			title: task.title,
			assignedByUserId: actor.userId,
			assignedByName: actor.name,
			pageId: task.pageId,
			sourceBlockId: task.sourceBlockId,
		},
		new Date().toISOString(),
	);
}

export const TaskAssignedNotification = defineNotification("tasks.assigned", {
	payload: TaskAssignedDeliveryPayloadSchema,
	description: "Notifies a member when another member assigns them a task.",
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

			const leaseUntil = new Date(Date.now() + 10 * 60 * 1000).toISOString();
			if (!(await ctx.ports.notificationInbox.claimPush(ids, leaseUntil))) {
				return {
					channel,
					status: "skipped",
					reason: "Another delivery invocation claimed this notification.",
				};
			}

			const count = payload.items.length;
			const only = payload.items[0];
			const assigner = only?.assignedByName ?? "A teammate";
			const title =
				count === 1
					? `${assigner} assigned you a task`
					: `${assigner} assigned you ${count} tasks`;
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
						tag: `tasks-assigned:${payload.userId}:${payload.workspaceId}`,
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

type DeliverableAssignmentNotification = Notification & {
	pushAttempts?: number;
};

function groupAssignments(items: DeliverableAssignmentNotification[]) {
	const groups = new Map<string, DeliverableAssignmentNotification[]>();
	for (const item of items) {
		if (item.kind !== "task.assigned") continue;
		const key = `${item.userId}:${item.workspaceId}:${item.payload.assignedByUserId}:${item.pushAttempts ?? 0}`;
		groups.set(key, [...(groups.get(key) ?? []), item]);
	}
	return groups.values();
}

export async function deliverTaskAssignmentNotifications(
	dependencies: { notifications: NotificationPort },
	items: DeliverableAssignmentNotification[],
): Promise<number> {
	let deliveryGroups = 0;
	const deliveryErrors: unknown[] = [];
	for (const group of groupAssignments(items)) {
		const first = group[0];
		if (first?.kind !== "task.assigned") continue;
		deliveryGroups += 1;
		try {
			await dependencies.notifications.send(TaskAssignedNotification, {
				userId: first.userId,
				workspaceId: first.workspaceId,
				notificationIds: group.map((item) => item.id),
				attempt: (first.pushAttempts ?? 0) + 1,
				items: group.flatMap((item) =>
					item.kind === "task.assigned" ? [item.payload] : [],
				),
			});
		} catch (error) {
			deliveryErrors.push(error);
		}
	}
	if (deliveryErrors.length > 0) {
		throw new AggregateError(
			deliveryErrors,
			"One or more task assignment notification deliveries failed.",
		);
	}
	return deliveryGroups;
}

export function createTaskAssignmentDeliveryPort(dependencies: {
	afterResponse: { schedule(work: () => Promise<void>): void };
	logger: LoggerPort;
	notifications: NotificationPort;
}): TaskAssignmentDeliveryPort {
	return {
		schedule(items) {
			if (items.length === 0) return;
			try {
				dependencies.afterResponse.schedule(async () => {
					try {
						await deliverTaskAssignmentNotifications(dependencies, items);
					} catch (error) {
						dependencies.logger.warn(
							"Failed to deliver task assignment notifications after response",
							{
								error,
								notificationIds: items.map((item) => item.id),
							},
						);
					}
				});
			} catch (error) {
				dependencies.logger.warn(
					"Failed to schedule task assignment notification delivery",
					{
						error,
						notificationIds: items.map((item) => item.id),
					},
				);
			}
		},
	};
}

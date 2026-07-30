import "@beignet/core/server-only";
import { createTenant, createTenantScope } from "@beignet/core/ports";
import { extractPageSearchText } from "@/features/pages/lib/extract-page-text";
import { appError } from "@/features/shared/errors";
import { patchTaskBlock } from "@/features/tasks/lib/patch-task-block";
import { zonedDateTimeToUtc } from "@/features/tasks/notifications/reminder";
import { requireUser } from "@/lib/auth";
import { canEditContent } from "@/lib/org-access";
import { localDateAndTime } from "@/lib/timezone";
import { useCase } from "@/lib/use-case";
import {
	TaskNotificationActionInputSchema,
	TaskNotificationActionOutputSchema,
} from "../schemas";

const MINUTE_MS = 60_000;

export function resolveSnoozedUntil(
	preset: "15m" | "1h" | "tomorrow_9am",
	now: Date,
	timezone: string,
) {
	if (preset === "15m") {
		return new Date(now.getTime() + 15 * MINUTE_MS);
	}
	if (preset === "1h") {
		return new Date(now.getTime() + 60 * MINUTE_MS);
	}

	const { date } = localDateAndTime(now, timezone);
	const [year, month, day] = date.split("-").map(Number);
	const tomorrow = new Date(Date.UTC(year, month - 1, day + 1))
		.toISOString()
		.slice(0, 10);
	return zonedDateTimeToUtc(tomorrow, "09:00", timezone);
}

export const actOnTaskNotificationUseCase = useCase
	.command("tasks.actOnNotification")
	.input(TaskNotificationActionInputSchema)
	.output(TaskNotificationActionOutputSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		const notification = await ctx.ports.notificationInbox.findByUser(
			user.id,
			input.id,
		);
		if (!notification) {
			throw appError("NotificationNotFound", {
				details: { id: input.id },
			});
		}

		const role = await ctx.ports.members.findRole(
			notification.workspaceId,
			user.id,
		);
		if (role === null) {
			throw appError("Forbidden", {
				message: "You no longer have access to this workspace.",
			});
		}
		const scope = createTenantScope(createTenant(notification.workspaceId));
		const task = await ctx.ports.tasks.findById(scope, notification.entityId);
		if (
			!task ||
			!notification.taskAvailable ||
			task.assigneeId !== user.id ||
			notification.taskAssigneeId !== user.id
		) {
			throw appError("NotificationNotActionable");
		}

		const now = new Date();
		const actionAt = now.toISOString();
		if (input.action === "snooze") {
			if (
				notification.kind === "task.assigned" ||
				notification.actionState !== null ||
				task.completed
			) {
				throw appError("NotificationNotActionable");
			}
			const preferences = await ctx.ports.notificationInbox.getPreferences(
				user.id,
			);
			const snoozedUntil = resolveSnoozedUntil(
				input.preset,
				now,
				preferences.timezone,
			).toISOString();
			const changed = await ctx.ports.notificationInbox.snooze(
				user.id,
				notification.id,
				snoozedUntil,
				actionAt,
			);
			if (!changed) throw appError("NotificationNotActionable");
			return {
				action: "snooze",
				notificationId: notification.id,
				taskId: task.id,
				workspaceId: task.workspaceId,
				pageId: task.pageId,
				snoozedUntil,
				unreadCount: await ctx.ports.notificationInbox.countUnread(user.id),
			};
		}

		if (!canEditContent(role)) {
			throw appError("Forbidden", {
				message: "You have view-only access to this workspace.",
			});
		}
		if (notification.actionState === "completed") {
			return {
				action: "complete",
				notificationId: notification.id,
				taskId: task.id,
				workspaceId: task.workspaceId,
				pageId: task.pageId,
				snoozedUntil: null,
				unreadCount: await ctx.ports.notificationInbox.countUnread(user.id),
			};
		}
		if (notification.actionState !== null) {
			throw appError("NotificationNotActionable");
		}

		await ctx.ports.uow.transaction(async (tx) => {
			const currentRole = await tx.members.findRole(
				notification.workspaceId,
				user.id,
			);
			const currentNotification = await tx.notificationInbox.findByUser(
				user.id,
				notification.id,
			);
			const currentTask = await tx.tasks.findById(scope, task.id);
			if (
				!currentNotification ||
				!currentTask ||
				!currentNotification.taskAvailable ||
				currentTask.assigneeId !== user.id ||
				(currentNotification.actionState !== null &&
					currentNotification.actionState !== "completed")
			) {
				throw appError("NotificationNotActionable");
			}
			if (!canEditContent(currentRole)) {
				throw appError("Forbidden", {
					message: "You have view-only access to this workspace.",
				});
			}
			if (
				currentNotification.actionState === "completed" ||
				currentTask.completed
			) {
				await tx.notificationInbox.resolveTaskNotifications(
					currentTask.id,
					"completed",
					actionAt,
				);
				return;
			}

			await tx.tasks.update(scope, currentTask.id, {
				completed: true,
				completedAt: actionAt,
			});
			if (currentTask.pageId && currentTask.sourceBlockId) {
				const page = await tx.pages.findById(scope, currentTask.pageId);
				if (page) {
					const patched = patchTaskBlock(
						page.content,
						currentTask.sourceBlockId,
						{ checked: true },
					);
					if (patched.found) {
						await tx.pages.saveContent(
							scope,
							page.id,
							JSON.stringify(patched.blocks),
							extractPageSearchText(patched.blocks),
						);
					}
				}
			}
			await tx.notificationInbox.resolveTaskNotifications(
				currentTask.id,
				"completed",
				actionAt,
			);
		});

		return {
			action: "complete",
			notificationId: notification.id,
			taskId: task.id,
			workspaceId: task.workspaceId,
			pageId: task.pageId,
			snoozedUntil: null,
			unreadCount: await ctx.ports.notificationInbox.countUnread(user.id),
		};
	});

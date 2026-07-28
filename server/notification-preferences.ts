import "@beignet/core/server-only";
import type { NotificationPreferencesPort } from "@beignet/core/notifications";
import type { NotificationRepository } from "@/features/notifications/ports";
import {
	TaskAssignedDeliveryPayloadSchema,
	TaskAssignedNotification,
} from "@/features/tasks/notifications/assigned";
import {
	TaskOverdueDeliveryPayloadSchema,
	TaskOverdueNotification,
} from "@/features/tasks/notifications/overdue";
import {
	TaskReminderDeliveryPayloadSchema,
	TaskReminderNotification,
} from "@/features/tasks/notifications/reminder";

// AppContext includes provider-inferred ports, so provider wiring must depend on
// this minimal context shape instead of introducing a recursive type.
type NotificationPreferenceContext = {
	ports: {
		notificationInbox: Pick<
			NotificationRepository,
			"getPreferences" | "markPushSkipped"
		>;
	};
};

export const notificationPreferences = {
	async evaluate({ notification, payload, ctx, channel }) {
		if (channel !== "push") return { deliver: true };

		const { notificationInbox } = (ctx as NotificationPreferenceContext).ports;
		if (notification.name === TaskOverdueNotification.name) {
			const delivery = TaskOverdueDeliveryPayloadSchema.parse(payload);
			const preferences = await notificationInbox.getPreferences(
				delivery.userId,
			);
			if (preferences.overdueTasksEnabled) return { deliver: true };
			await notificationInbox.markPushSkipped(delivery.notificationIds);
			return {
				deliver: false,
				reason: "Overdue notifications are disabled.",
			};
		}
		if (notification.name === TaskAssignedNotification.name) {
			const delivery = TaskAssignedDeliveryPayloadSchema.parse(payload);
			const preferences = await notificationInbox.getPreferences(
				delivery.userId,
			);
			if (preferences.taskAssignmentsEnabled) return { deliver: true };
			await notificationInbox.markPushSkipped(delivery.notificationIds);
			return {
				deliver: false,
				reason: "Task assignment notifications are disabled.",
			};
		}
		if (notification.name === TaskReminderNotification.name) {
			const delivery = TaskReminderDeliveryPayloadSchema.parse(payload);
			const preferences = await notificationInbox.getPreferences(
				delivery.userId,
			);
			if (preferences.taskRemindersEnabled) return { deliver: true };
			await notificationInbox.markPushSkipped(delivery.notificationIds);
			return {
				deliver: false,
				reason: "Task reminders are disabled.",
			};
		}
		return { deliver: true };
	},
} satisfies NotificationPreferencesPort<unknown>;

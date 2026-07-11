import "@beignet/core/server-only";
import type { NotificationPreferencesPort } from "@beignet/core/notifications";
import type { NotificationRepository } from "@/features/notifications/ports";
import {
	TaskOverdueDeliveryPayloadSchema,
	TaskOverdueNotification,
} from "@/features/tasks/notifications/overdue";

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
		if (
			notification.name !== TaskOverdueNotification.name ||
			channel !== "push"
		) {
			return { deliver: true };
		}

		const delivery = TaskOverdueDeliveryPayloadSchema.parse(payload);
		const { notificationInbox } = (ctx as NotificationPreferenceContext).ports;
		const preferences = await notificationInbox.getPreferences(delivery.userId);
		if (preferences.overdueTasksEnabled) return { deliver: true };

		await notificationInbox.markPushSkipped(delivery.notificationIds);
		return {
			deliver: false,
			reason: "Overdue notifications are disabled.",
		};
	},
} satisfies NotificationPreferencesPort<unknown>;

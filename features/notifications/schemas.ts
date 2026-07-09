import { z } from "zod";

export const NotificationKindSchema = z.literal("task.overdue");
export type NotificationKind = z.infer<typeof NotificationKindSchema>;

export const TaskOverdueNotificationPayloadSchema = z.object({
	taskId: z.string().uuid(),
	title: z.string(),
	dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	pageId: z.string().uuid().nullable(),
	sourceBlockId: z.string().nullable(),
});
export type TaskOverdueNotificationPayload = z.infer<
	typeof TaskOverdueNotificationPayloadSchema
>;

export const NotificationSchema = z.object({
	id: z.string().uuid(),
	userId: z.string(),
	workspaceId: z.string(),
	kind: NotificationKindSchema,
	entityId: z.string().uuid(),
	entityVersion: z.string(),
	payload: TaskOverdueNotificationPayloadSchema,
	readAt: z.string().datetime().nullable(),
	createdAt: z.string().datetime(),
});
export type Notification = z.infer<typeof NotificationSchema>;

export const ListNotificationsInputSchema = z.object({
	cursor: z.string().optional(),
	limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const ListNotificationsOutputSchema = z.object({
	items: z.array(NotificationSchema),
	unreadCount: z.number().int().min(0),
	nextCursor: z.string().nullable(),
});

export const NotificationIdInputSchema = z.object({
	id: z.string().uuid(),
});

export const NotificationPreferencesSchema = z.object({
	overdueTasksEnabled: z.boolean(),
	timezone: z.string().min(1).max(100),
});
export type NotificationPreferences = z.infer<
	typeof NotificationPreferencesSchema
>;

export const NotificationSettingsSchema = NotificationPreferencesSchema.extend({
	pushSupported: z.boolean(),
	vapidPublicKey: z.string().nullable(),
});

export const UpdateNotificationPreferencesSchema = z
	.object({
		overdueTasksEnabled: z.boolean().optional(),
		timezone: z.string().min(1).max(100).optional(),
	})
	.refine((value) => Object.keys(value).length > 0, {
		message: "At least one notification preference is required.",
	});

export const PushSubscriptionSchema = z.object({
	endpoint: z.string().url().max(2048),
	expirationTime: z.number().nullable().optional(),
	keys: z.object({
		p256dh: z.string().min(1).max(512),
		auth: z.string().min(1).max(512),
	}),
});
export type PushSubscriptionInput = z.infer<typeof PushSubscriptionSchema>;

export const PushSubscriptionOutputSchema = z.object({
	subscribed: z.boolean(),
});

export const PushSubscriptionEndpointSchema = z.object({
	endpoint: z.string().url().max(2048),
});

export const TestPushOutputSchema = z.object({
	sent: z.boolean(),
});

export const MarkNotificationsReadOutputSchema = z.object({
	unreadCount: z.number().int().min(0),
});

export function isValidTimezone(timezone: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
		return true;
	} catch {
		return false;
	}
}

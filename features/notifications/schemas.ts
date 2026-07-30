import { z } from "zod";

export const NotificationKindSchema = z.enum([
	"task.overdue",
	"task.assigned",
	"task.reminder",
]);
export type NotificationKind = z.infer<typeof NotificationKindSchema>;

export const NotificationActionStateSchema = z.enum([
	"completed",
	"snoozed",
	"dismissed",
]);
export type NotificationActionState = z.infer<
	typeof NotificationActionStateSchema
>;

export const TaskOverdueNotificationPayloadSchema = z.object({
	taskId: z.string().uuid(),
	title: z.string(),
	dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	dueTime: z
		.string()
		.regex(/^([01]\d|2[0-3]):[0-5]\d$/)
		.nullable()
		.default(null),
	pageId: z.string().uuid().nullable(),
	sourceBlockId: z.string().nullable(),
});
export type TaskOverdueNotificationPayload = z.infer<
	typeof TaskOverdueNotificationPayloadSchema
>;

export const TaskAssignedNotificationPayloadSchema = z.object({
	taskId: z.string().uuid(),
	title: z.string(),
	assignedByUserId: z.string(),
	assignedByName: z.string(),
	pageId: z.string().uuid().nullable(),
	sourceBlockId: z.string().nullable(),
});
export type TaskAssignedNotificationPayload = z.infer<
	typeof TaskAssignedNotificationPayloadSchema
>;

export const TaskReminderNotificationPayloadSchema = z.object({
	taskId: z.string().uuid(),
	title: z.string(),
	dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	dueTime: z
		.string()
		.regex(/^([01]\d|2[0-3]):[0-5]\d$/)
		.nullable(),
	reminderOffsetMinutes: z.union([
		z.literal(0),
		z.literal(15),
		z.literal(60),
		z.literal(1_440),
	]),
	rearmed: z.boolean().optional(),
	pageId: z.string().uuid().nullable(),
	sourceBlockId: z.string().nullable(),
});
export type TaskReminderNotificationPayload = z.infer<
	typeof TaskReminderNotificationPayloadSchema
>;

const NotificationBaseSchema = z.object({
	id: z.string().uuid(),
	userId: z.string(),
	workspaceId: z.string(),
	entityId: z.string().uuid(),
	entityVersion: z.string(),
	readAt: z.string().datetime().nullable(),
	createdAt: z.string().datetime(),
	actionState: NotificationActionStateSchema.nullable().optional(),
	actionAt: z.string().datetime().nullable().optional(),
	snoozedUntil: z.string().datetime().nullable().optional(),
	taskCompleted: z.boolean().optional(),
	taskAssigneeId: z.string().nullable().optional(),
	taskAvailable: z.boolean().optional(),
	taskCanComplete: z.boolean().optional(),
});

export const TaskOverdueInboxNotificationSchema = NotificationBaseSchema.extend(
	{
		kind: z.literal("task.overdue"),
		payload: TaskOverdueNotificationPayloadSchema,
	},
);

export const TaskAssignedInboxNotificationSchema =
	NotificationBaseSchema.extend({
		kind: z.literal("task.assigned"),
		payload: TaskAssignedNotificationPayloadSchema,
	});

export const TaskReminderInboxNotificationSchema =
	NotificationBaseSchema.extend({
		kind: z.literal("task.reminder"),
		payload: TaskReminderNotificationPayloadSchema,
	});

export const NotificationSchema = z.discriminatedUnion("kind", [
	TaskOverdueInboxNotificationSchema,
	TaskAssignedInboxNotificationSchema,
	TaskReminderInboxNotificationSchema,
]);
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
export type ListNotificationsOutput = z.infer<
	typeof ListNotificationsOutputSchema
>;

export const NotificationIdInputSchema = z.object({
	id: z.string().uuid(),
});

export const NotificationPreferencesSchema = z.object({
	overdueTasksEnabled: z.boolean(),
	taskAssignmentsEnabled: z.boolean(),
	taskRemindersEnabled: z.boolean(),
	timezone: z.string().min(1).max(100),
	timezoneConfigured: z.boolean(),
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
		taskAssignmentsEnabled: z.boolean().optional(),
		taskRemindersEnabled: z.boolean().optional(),
		timezone: z.string().min(1).max(100).optional(),
	})
	.refine((value) => Object.keys(value).length > 0, {
		message: "At least one notification preference is required.",
	});

export const InitializeNotificationTimezoneSchema = z.object({
	timezone: z.string().min(1).max(100),
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

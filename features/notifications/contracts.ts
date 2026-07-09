import { defineContractGroup } from "@beignet/core/contracts";
import { z } from "zod";
import {
	ListNotificationsInputSchema,
	ListNotificationsOutputSchema,
	MarkNotificationsReadOutputSchema,
	NotificationIdInputSchema,
	NotificationSettingsSchema,
	PushSubscriptionEndpointSchema,
	PushSubscriptionOutputSchema,
	PushSubscriptionSchema,
	TestPushOutputSchema,
	UpdateNotificationPreferencesSchema,
} from "@/features/notifications/schemas";
import { errors } from "@/features/shared/errors";

const ErrorResponseSchema = z.object({
	code: z.string(),
	message: z.string(),
	requestId: z.string().optional(),
});

const notifications = defineContractGroup()
	.namespace("notifications")
	.errors({ Unauthorized: errors.Unauthorized })
	.responses({ 500: ErrorResponseSchema });

export const listNotifications = notifications
	.get("/api/notifications")
	.query(ListNotificationsInputSchema)
	.responses({ 200: ListNotificationsOutputSchema });

export const markNotificationRead = notifications
	.patch("/api/notifications/:id/read")
	.pathParams(NotificationIdInputSchema)
	.errors({ NotificationNotFound: errors.NotificationNotFound })
	.responses({ 200: MarkNotificationsReadOutputSchema });

export const markAllNotificationsRead = notifications
	.post("/api/notifications/read-all")
	.body(z.object({}))
	.responses({ 200: MarkNotificationsReadOutputSchema });

export const getNotificationSettings = notifications
	.get("/api/notification-settings")
	.responses({ 200: NotificationSettingsSchema });

export const updateNotificationSettings = notifications
	.patch("/api/notification-settings")
	.body(UpdateNotificationPreferencesSchema)
	.responses({ 200: NotificationSettingsSchema });

export const subscribePush = notifications
	.post("/api/push-subscriptions")
	.body(PushSubscriptionSchema)
	.errors({ PushUnavailable: errors.PushUnavailable })
	.responses({ 200: PushSubscriptionOutputSchema });

export const unsubscribePush = notifications
	.post("/api/push-subscriptions/unsubscribe")
	.body(PushSubscriptionEndpointSchema)
	.responses({ 200: PushSubscriptionOutputSchema });

export const testPush = notifications
	.post("/api/push-subscriptions/test")
	.body(PushSubscriptionEndpointSchema)
	.errors({ PushUnavailable: errors.PushUnavailable })
	.responses({ 200: TestPushOutputSchema });

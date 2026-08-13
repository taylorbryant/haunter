import {
	defineContractGroup,
	defineQueryTransport,
	query,
} from "@beignet/core/contracts";
import { z } from "zod";
import {
	InitializeNotificationTimezoneSchema,
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
import { ErrorResponseSchema } from "@/features/shared/schemas";

const notifications = defineContractGroup()
	.namespace("notifications")
	.meta({ auth: "required" })
	.errors({ Unauthorized: errors.Unauthorized })
	.responses({ 500: ErrorResponseSchema });

export const listNotifications = notifications
	.get("/api/notifications")
	.query(
		ListNotificationsInputSchema,
		defineQueryTransport({
			cursor: query.string(),
			limit: query.integer(),
		}),
	)
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
	.errors({ InvalidTimezone: errors.InvalidTimezone })
	.responses({ 200: NotificationSettingsSchema });

export const initializeNotificationTimezone = notifications
	.post("/api/notification-settings/timezone/initialize")
	.body(InitializeNotificationTimezoneSchema)
	.errors({ InvalidTimezone: errors.InvalidTimezone })
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

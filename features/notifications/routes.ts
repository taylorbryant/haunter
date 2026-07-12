import "@beignet/core/server-only";
import {
	getNotificationSettings,
	initializeNotificationTimezone,
	listNotifications,
	markAllNotificationsRead,
	markNotificationRead,
	subscribePush,
	testPush,
	unsubscribePush,
	updateNotificationSettings,
} from "@/features/notifications/contracts";
import {
	getNotificationSettingsUseCase,
	initializeNotificationTimezoneUseCase,
	listNotificationsUseCase,
	markAllNotificationsReadUseCase,
	markNotificationReadUseCase,
	subscribePushUseCase,
	testPushUseCase,
	unsubscribePushUseCase,
	updateNotificationSettingsUseCase,
} from "@/features/notifications/use-cases";
import { defineRouteGroup } from "@/lib/routes";
import { routeAuth } from "@/server/auth-hooks";

export const notificationRoutes = defineRouteGroup({
	name: "notifications",
	hooks: [routeAuth.required()],
	routes: [
		{ contract: listNotifications, useCase: listNotificationsUseCase },
		{ contract: markNotificationRead, useCase: markNotificationReadUseCase },
		{
			contract: markAllNotificationsRead,
			useCase: markAllNotificationsReadUseCase,
		},
		{
			contract: getNotificationSettings,
			useCase: getNotificationSettingsUseCase,
		},
		{
			contract: updateNotificationSettings,
			useCase: updateNotificationSettingsUseCase,
		},
		{
			contract: initializeNotificationTimezone,
			useCase: initializeNotificationTimezoneUseCase,
		},
		{ contract: subscribePush, useCase: subscribePushUseCase },
		{ contract: unsubscribePush, useCase: unsubscribePushUseCase },
		{ contract: testPush, useCase: testPushUseCase },
	],
});

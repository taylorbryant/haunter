import "@beignet/core/server-only";
import { defineRouteGroup } from "@beignet/next";
import type { AppContext } from "@/app-context";
import {
	getNotificationSettings,
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
	listNotificationsUseCase,
	markAllNotificationsReadUseCase,
	markNotificationReadUseCase,
	subscribePushUseCase,
	testPushUseCase,
	unsubscribePushUseCase,
	updateNotificationSettingsUseCase,
} from "@/features/notifications/use-cases";

export const notificationRoutes = defineRouteGroup<AppContext>()({
	name: "notifications",
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
		{ contract: subscribePush, useCase: subscribePushUseCase },
		{ contract: unsubscribePush, useCase: unsubscribePushUseCase },
		{ contract: testPush, useCase: testPushUseCase },
	],
});

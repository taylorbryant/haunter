import type { QueryClient } from "@tanstack/react-query";
import { rq } from "@/client";
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

export function listNotificationsQueryOptions(limit = 30) {
	return {
		...rq(listNotifications).queryOptions({ query: { limit } }),
		refetchInterval: 30_000,
	};
}

export function notificationSettingsQueryOptions() {
	return rq(getNotificationSettings).queryOptions({});
}

export const markNotificationReadMutationOptions = () =>
	rq(markNotificationRead).mutationOptions();
export const markAllNotificationsReadMutationOptions = () =>
	rq(markAllNotificationsRead).mutationOptions();
export const updateNotificationSettingsMutationOptions = () =>
	rq(updateNotificationSettings).mutationOptions();
export const initializeNotificationTimezoneMutationOptions = () =>
	rq(initializeNotificationTimezone).mutationOptions();
export const subscribePushMutationOptions = () =>
	rq(subscribePush).mutationOptions();
export const unsubscribePushMutationOptions = () =>
	rq(unsubscribePush).mutationOptions();
export const testPushMutationOptions = () => rq(testPush).mutationOptions();

export function invalidateNotifications(queryClient: QueryClient) {
	return rq(listNotifications).invalidate(queryClient);
}

export function invalidateNotificationSettings(queryClient: QueryClient) {
	return rq(getNotificationSettings).invalidate(queryClient);
}

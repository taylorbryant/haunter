import type { QueryClient, QueryKey } from "@tanstack/react-query";
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
import type {
	ListNotificationsOutput,
	Notification,
} from "@/features/notifications/schemas";

export type NotificationsCacheSnapshot = Array<
	[QueryKey, ListNotificationsOutput | undefined]
>;

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

export async function removeNotificationFromCache(
	queryClient: QueryClient,
	item: Pick<Notification, "id" | "readAt">,
): Promise<NotificationsCacheSnapshot> {
	const filter = rq(listNotifications).filter();
	await queryClient.cancelQueries(filter, { revert: false, silent: true });
	const snapshot = queryClient.getQueriesData<ListNotificationsOutput>(filter);
	queryClient.setQueriesData<ListNotificationsOutput>(filter, (current) => {
		if (!current) return current;
		return {
			...current,
			items: current.items.filter(
				(notification) => notification.id !== item.id,
			),
			unreadCount:
				item.readAt === null
					? Math.max(0, current.unreadCount - 1)
					: current.unreadCount,
		};
	});
	return snapshot;
}

export function restoreNotificationsCache(
	queryClient: QueryClient,
	snapshot: NotificationsCacheSnapshot,
) {
	for (const [queryKey, data] of snapshot) {
		queryClient.setQueryData(queryKey, data);
	}
}

export function invalidateNotificationSettings(queryClient: QueryClient) {
	return rq(getNotificationSettings).invalidate(queryClient);
}

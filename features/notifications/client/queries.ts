import type { ContractUseMutationOptions } from "@beignet/react-query";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { rq } from "@/client";
import { protectedRefetchInterval } from "@/client/session-recovery";
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
	NotificationSettings,
	UpdateNotificationPreferences,
} from "@/features/notifications/schemas";
import { refreshAfterTaskWrites } from "@/features/tasks/client/refresh";

export type NotificationRemovalCacheSnapshot = Array<{
	queryKey: QueryKey;
	item: Notification | undefined;
	previousIndex: number;
	unreadDelta: number;
}>;

export type NotificationReadCacheSnapshot = Array<{
	queryKey: QueryKey;
	previousItems: Array<{ id: string; readAt: string | null }>;
	optimisticReadAt: string;
	operationId: string;
	unreadDelta: number;
}>;

const optimisticReadOperations = "__haunterOptimisticReadOperations" as const;

type NotificationsCacheData = ListNotificationsOutput & {
	[optimisticReadOperations]?: Record<string, number>;
};

function addOptimisticReadOperation(
	current: ListNotificationsOutput,
	operationId: string,
	unreadDelta: number,
): NotificationsCacheData {
	const cached = current as NotificationsCacheData;
	return {
		...current,
		[optimisticReadOperations]: {
			...(cached[optimisticReadOperations] ?? {}),
			[operationId]: unreadDelta,
		},
	};
}

export function listNotificationsQueryOptions(limit = 30) {
	return {
		...rq(listNotifications).queryOptions({ query: { limit } }),
		refetchInterval: protectedRefetchInterval,
	};
}

export function notificationSettingsQueryOptions() {
	return rq(getNotificationSettings).queryOptions({});
}

export const markNotificationReadMutationOptions = () =>
	rq(markNotificationRead).mutationOptions();
export const markAllNotificationsReadMutationOptions = () =>
	rq(markAllNotificationsRead).mutationOptions();
export const updateNotificationSettingsMutationOptions = (
	options: Pick<
		ContractUseMutationOptions<typeof updateNotificationSettings.config>,
		"onSuccess"
	> = {},
) =>
	rq(updateNotificationSettings).mutationOptions({
		...options,
		invalidates: () => [rq(getNotificationSettings).filter()],
	});
export const initializeNotificationTimezoneMutationOptions = () =>
	rq(initializeNotificationTimezone).mutationOptions({
		invalidates: () => [rq(getNotificationSettings).filter()],
	});
export const subscribePushMutationOptions = () =>
	rq(subscribePush).mutationOptions();
export const unsubscribePushMutationOptions = () =>
	rq(unsubscribePush).mutationOptions();
export const testPushMutationOptions = () => rq(testPush).mutationOptions();

export function invalidateNotifications(queryClient: QueryClient) {
	return refreshAfterTaskWrites(queryClient, [rq(listNotifications).filter()]);
}

export async function markNotificationReadInCache(
	queryClient: QueryClient,
	item: Pick<Notification, "id" | "readAt">,
): Promise<NotificationReadCacheSnapshot> {
	const filter = rq(listNotifications).filter();
	await queryClient.cancelQueries(filter, { revert: false, silent: true });
	const optimisticReadAt = new Date().toISOString();
	const operationId = crypto.randomUUID();
	const snapshot: NotificationReadCacheSnapshot = [];

	for (const { queryKey, data: current } of rq(listNotifications).cacheEntries(
		queryClient,
	)) {
		if (!current) continue;
		const notification = current.items.find(
			(notification) => notification.id === item.id,
		);
		const unreadDelta = item.readAt === null && current.unreadCount > 0 ? 1 : 0;
		snapshot.push({
			queryKey,
			previousItems: notification
				? [{ id: notification.id, readAt: notification.readAt }]
				: [],
			optimisticReadAt,
			operationId,
			unreadDelta,
		});
		const next = addOptimisticReadOperation(current, operationId, unreadDelta);
		queryClient.setQueryData<ListNotificationsOutput>(queryKey, {
			...next,
			items: current.items.map((item) =>
				item.id === notification?.id
					? { ...item, readAt: optimisticReadAt }
					: item,
			),
			unreadCount: current.unreadCount - unreadDelta,
		});
	}

	return snapshot;
}

export async function markAllNotificationsReadInCache(
	queryClient: QueryClient,
): Promise<NotificationReadCacheSnapshot> {
	const filter = rq(listNotifications).filter();
	await queryClient.cancelQueries(filter, { revert: false, silent: true });
	const optimisticReadAt = new Date().toISOString();
	const operationId = crypto.randomUUID();
	const snapshot: NotificationReadCacheSnapshot = [];

	for (const { queryKey, data: current } of rq(listNotifications).cacheEntries(
		queryClient,
	)) {
		if (!current) continue;
		snapshot.push({
			queryKey,
			previousItems: current.items
				.filter((item) => item.readAt === null)
				.map((item) => ({ id: item.id, readAt: item.readAt })),
			optimisticReadAt,
			operationId,
			unreadDelta: current.unreadCount,
		});
		const next = addOptimisticReadOperation(
			current,
			operationId,
			current.unreadCount,
		);
		queryClient.setQueryData<ListNotificationsOutput>(queryKey, {
			...next,
			items: current.items.map((item) =>
				item.readAt === null ? { ...item, readAt: optimisticReadAt } : item,
			),
			unreadCount: 0,
		});
	}

	return snapshot;
}

export function restoreNotificationReadCache(
	queryClient: QueryClient,
	snapshot: NotificationReadCacheSnapshot,
) {
	for (const entry of snapshot) {
		queryClient.setQueryData<ListNotificationsOutput>(
			entry.queryKey,
			(current) => {
				if (!current) return current;
				const cached = current as NotificationsCacheData;
				const operations = cached[optimisticReadOperations] ?? {};
				const operationStillApplied =
					Object.hasOwn(operations, entry.operationId) ||
					entry.previousItems.some((previous) =>
						current.items.some(
							(item) =>
								item.id === previous.id &&
								item.readAt === entry.optimisticReadAt,
						),
					);
				const { [entry.operationId]: _removed, ...remainingOperations } =
					operations;
				const previousReadAtById = new Map(
					entry.previousItems.map((item) => [item.id, item.readAt] as const),
				);
				const { [optimisticReadOperations]: _operations, ...base } = cached;
				return {
					...base,
					...(Object.keys(remainingOperations).length > 0
						? { [optimisticReadOperations]: remainingOperations }
						: {}),
					items: current.items.map((item) => {
						const previousReadAt = previousReadAtById.get(item.id);
						return previousReadAt !== undefined &&
							item.readAt === entry.optimisticReadAt
							? { ...item, readAt: previousReadAt }
							: item;
					}),
					unreadCount: operationStillApplied
						? current.unreadCount + entry.unreadDelta
						: current.unreadCount,
				};
			},
		);
	}
}

export function commitNotificationReadCache(
	queryClient: QueryClient,
	snapshot: NotificationReadCacheSnapshot,
) {
	for (const entry of snapshot) {
		queryClient.setQueryData<ListNotificationsOutput>(
			entry.queryKey,
			(current) => {
				if (!current) return current;
				const cached = current as NotificationsCacheData;
				const operations = cached[optimisticReadOperations];
				if (!operations || !Object.hasOwn(operations, entry.operationId)) {
					return current;
				}
				const { [entry.operationId]: _removed, ...remainingOperations } =
					operations;
				const { [optimisticReadOperations]: _operations, ...base } = cached;
				return {
					...base,
					...(Object.keys(remainingOperations).length > 0
						? { [optimisticReadOperations]: remainingOperations }
						: {}),
				};
			},
		);
	}
}

export async function removeNotificationFromCache(
	queryClient: QueryClient,
	item: Pick<Notification, "id" | "readAt">,
): Promise<NotificationRemovalCacheSnapshot> {
	await queryClient.cancelQueries(rq(listNotifications).filter(), {
		revert: false,
		silent: true,
	});
	const snapshot: NotificationRemovalCacheSnapshot = [];
	for (const { queryKey, data: current } of rq(listNotifications).cacheEntries(
		queryClient,
	)) {
		if (!current) continue;
		const previousIndex = current.items.findIndex(
			(notification) => notification.id === item.id,
		);
		const previous = current.items[previousIndex];
		const unreadDelta =
			(previous ? previous.readAt : item.readAt) === null &&
			current.unreadCount > 0
				? 1
				: 0;
		snapshot.push({ queryKey, item: previous, previousIndex, unreadDelta });
		queryClient.setQueryData<ListNotificationsOutput>(queryKey, {
			...current,
			items: current.items.filter(
				(notification) => notification.id !== item.id,
			),
			unreadCount: current.unreadCount - unreadDelta,
		});
	}
	return snapshot;
}

/** Restore only this removal; other task actions and read changes stay applied. */
export function restoreRemovedNotificationCache(
	queryClient: QueryClient,
	snapshot: NotificationRemovalCacheSnapshot,
) {
	for (const entry of snapshot) {
		queryClient.setQueryData<ListNotificationsOutput>(
			entry.queryKey,
			(current) => {
				if (
					!current ||
					(entry.item &&
						current.items.some((item) => item.id === entry.item?.id))
				)
					return current;
				const items = [...current.items];
				if (entry.item)
					items.splice(
						Math.min(entry.previousIndex, items.length),
						0,
						entry.item,
					);
				return {
					...current,
					items,
					unreadCount: current.unreadCount + entry.unreadDelta,
				};
			},
		);
	}
}

export function invalidateNotificationSettings(queryClient: QueryClient) {
	return rq(getNotificationSettings).invalidate(queryClient);
}

export async function optimisticallyUpdateNotificationSettings(
	queryClient: QueryClient,
	patch: UpdateNotificationPreferences,
) {
	const queryKey = rq(getNotificationSettings).key({});
	await queryClient.cancelQueries(
		{ queryKey, exact: true },
		{ revert: false, silent: true },
	);
	const previous = queryClient.getQueryData<NotificationSettings>(queryKey);
	queryClient.setQueryData<NotificationSettings>(queryKey, (current) =>
		current
			? {
					...current,
					...patch,
					...(patch.timezone ? { timezoneConfigured: true } : {}),
				}
			: current,
	);
	return { queryKey, previous };
}

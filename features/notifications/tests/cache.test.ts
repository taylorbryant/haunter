import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
	commitNotificationReadCache,
	listNotificationsQueryOptions,
	markAllNotificationsReadInCache,
	markNotificationReadInCache,
	notificationSettingsQueryOptions,
	optimisticallyUpdateNotificationSettings,
	removeNotificationFromCache,
	restoreNotificationReadCache,
	restoreNotificationsCache,
} from "@/features/notifications/client/queries";
import type {
	ListNotificationsOutput,
	Notification,
	NotificationSettings,
} from "@/features/notifications/schemas";

const notification: Notification = {
	id: "4f9859fe-8aa4-48cf-b2d7-e382f709e784",
	userId: "user_1",
	workspaceId: "workspace_1",
	kind: "task.overdue",
	entityId: "31cc7263-1358-47f0-88cc-a4595ff26b0e",
	entityVersion: "2026-07-29:user_1",
	payload: {
		taskId: "31cc7263-1358-47f0-88cc-a4595ff26b0e",
		title: "Review the launch plan",
		dueDate: "2026-07-29",
		dueTime: null,
		pageId: null,
		sourceBlockId: null,
	},
	readAt: null,
	createdAt: "2026-07-29T14:00:00.000Z",
	actionState: null,
	actionAt: null,
	snoozedUntil: null,
	taskCompleted: false,
	taskAssigneeId: "user_1",
	taskAvailable: true,
	taskCanComplete: true,
};

test("notification cache removes active items and restores failed actions", async () => {
	const queryClient = new QueryClient();
	const visibleKey = listNotificationsQueryOptions(30).queryKey;
	const smallerPageKey = listNotificationsQueryOptions(1).queryKey;
	const visible: ListNotificationsOutput = {
		items: [notification],
		unreadCount: 1,
		nextCursor: null,
	};
	const smallerPage: ListNotificationsOutput = {
		items: [],
		unreadCount: 1,
		nextCursor: null,
	};
	queryClient.setQueryData(visibleKey, visible);
	queryClient.setQueryData(smallerPageKey, smallerPage);

	const snapshot = await removeNotificationFromCache(queryClient, notification);

	expect(queryClient.getQueryData<ListNotificationsOutput>(visibleKey)).toEqual(
		{
			...visible,
			items: [],
			unreadCount: 0,
		},
	);
	expect(
		queryClient.getQueryData<ListNotificationsOutput>(smallerPageKey),
	).toEqual({
		...smallerPage,
		unreadCount: 0,
	});

	restoreNotificationsCache(queryClient, snapshot);
	expect(queryClient.getQueryData<ListNotificationsOutput>(visibleKey)).toEqual(
		visible,
	);
	expect(
		queryClient.getQueryData<ListNotificationsOutput>(smallerPageKey),
	).toEqual(smallerPage);
});

test("notification reads update every cached page and can roll back", async () => {
	const queryClient = new QueryClient();
	const visibleKey = listNotificationsQueryOptions(30).queryKey;
	const smallerPageKey = listNotificationsQueryOptions(1).queryKey;
	const visible: ListNotificationsOutput = {
		items: [notification],
		unreadCount: 1,
		nextCursor: null,
	};
	const smallerPage: ListNotificationsOutput = {
		items: [],
		unreadCount: 1,
		nextCursor: null,
	};
	queryClient.setQueryData(visibleKey, visible);
	queryClient.setQueryData(smallerPageKey, smallerPage);

	const snapshot = await markNotificationReadInCache(queryClient, notification);

	expect(
		queryClient.getQueryData<ListNotificationsOutput>(visibleKey)?.items[0]
			?.readAt,
	).not.toBeNull();
	expect(
		queryClient.getQueryData<ListNotificationsOutput>(visibleKey)?.unreadCount,
	).toBe(0);
	expect(
		queryClient.getQueryData<ListNotificationsOutput>(smallerPageKey)
			?.unreadCount,
	).toBe(0);

	restoreNotificationReadCache(queryClient, snapshot);
	expect(queryClient.getQueryData<ListNotificationsOutput>(visibleKey)).toEqual(
		visible,
	);
	expect(
		queryClient.getQueryData<ListNotificationsOutput>(smallerPageKey),
	).toEqual(smallerPage);
});

test("successful notification reads discard client-only rollback ownership", async () => {
	const queryClient = new QueryClient();
	const queryKey = listNotificationsQueryOptions(30).queryKey;
	queryClient.setQueryData<ListNotificationsOutput>(queryKey, {
		items: [notification],
		unreadCount: 1,
		nextCursor: null,
	});

	const snapshot = await markNotificationReadInCache(queryClient, notification);
	commitNotificationReadCache(queryClient, snapshot);

	expect(queryClient.getQueryData<ListNotificationsOutput>(queryKey)).toEqual({
		items: [
			{
				...notification,
				readAt: expect.any(String),
			},
		],
		unreadCount: 0,
		nextCursor: null,
	});
});

test("mark-all rollback preserves notifications that arrived afterward", async () => {
	const queryClient = new QueryClient();
	const queryKey = listNotificationsQueryOptions(30).queryKey;
	const secondNotification: Notification = {
		...notification,
		id: "21ca21f7-fd57-4c9b-9a62-b5ad54cfe2c8",
		entityVersion: "2026-07-30:user_1",
		payload: {
			...notification.payload,
			title: "Prepare the launch summary",
		},
	};
	const initial: ListNotificationsOutput = {
		items: [notification, secondNotification],
		unreadCount: 2,
		nextCursor: null,
	};
	queryClient.setQueryData(queryKey, initial);

	const snapshot = await markAllNotificationsReadInCache(queryClient);
	const arrivedNotification: Notification = {
		...notification,
		id: "dff87791-cc4c-438a-9eaf-d8291bac4556",
		entityVersion: "2026-07-31:user_1",
		payload: {
			...notification.payload,
			title: "Review the final release",
		},
	};
	queryClient.setQueryData<ListNotificationsOutput>(queryKey, (current) => ({
		items: [arrivedNotification, ...(current?.items ?? [])],
		unreadCount: 1,
		nextCursor: null,
	}));

	restoreNotificationReadCache(queryClient, snapshot);
	const restored = queryClient.getQueryData<ListNotificationsOutput>(queryKey);
	expect(restored?.unreadCount).toBe(3);
	expect(restored?.items.map((item) => item.readAt)).toEqual([
		null,
		null,
		null,
	]);
});

test("read rollback does not double-count after a refetch restored server state", async () => {
	const queryClient = new QueryClient();
	const queryKey = listNotificationsQueryOptions(30).queryKey;
	const initial: ListNotificationsOutput = {
		items: [notification],
		unreadCount: 1,
		nextCursor: null,
	};
	queryClient.setQueryData(queryKey, initial);

	const snapshot = await markNotificationReadInCache(queryClient, notification);
	queryClient.setQueryData(queryKey, initial);
	restoreNotificationReadCache(queryClient, snapshot);

	expect(queryClient.getQueryData<ListNotificationsOutput>(queryKey)).toEqual(
		initial,
	);
});

test("read rollback restores each cached page independently", async () => {
	const queryClient = new QueryClient();
	const visibleKey = listNotificationsQueryOptions(30).queryKey;
	const smallerPageKey = listNotificationsQueryOptions(1).queryKey;
	const visible: ListNotificationsOutput = {
		items: [notification],
		unreadCount: 1,
		nextCursor: null,
	};
	const smallerPage: ListNotificationsOutput = {
		items: [],
		unreadCount: 1,
		nextCursor: null,
	};
	queryClient.setQueryData(visibleKey, visible);
	queryClient.setQueryData(smallerPageKey, smallerPage);

	const snapshot = await markNotificationReadInCache(queryClient, notification);
	// Only the larger page refetches before the mutation fails. The smaller
	// page still owns its optimistic unread-count decrement.
	queryClient.setQueryData(visibleKey, visible);
	restoreNotificationReadCache(queryClient, snapshot);

	expect(queryClient.getQueryData<ListNotificationsOutput>(visibleKey)).toEqual(
		visible,
	);
	expect(
		queryClient.getQueryData<ListNotificationsOutput>(smallerPageKey),
	).toEqual(smallerPage);
});

test("notification preferences update immediately and expose a rollback snapshot", async () => {
	const queryClient = new QueryClient();
	const queryKey = notificationSettingsQueryOptions().queryKey;
	const settings: NotificationSettings = {
		overdueTasksEnabled: true,
		taskAssignmentsEnabled: true,
		taskRemindersEnabled: true,
		timezone: "America/Chicago",
		timezoneConfigured: false,
		pushSupported: true,
		vapidPublicKey: "public-key",
	};
	queryClient.setQueryData(queryKey, settings);

	const snapshot = await optimisticallyUpdateNotificationSettings(queryClient, {
		timezone: "America/New_York",
	});
	expect(queryClient.getQueryData<NotificationSettings>(queryKey)).toEqual({
		...settings,
		timezone: "America/New_York",
		timezoneConfigured: true,
	});

	queryClient.setQueryData(snapshot.queryKey, snapshot.previous);
	expect(queryClient.getQueryData<NotificationSettings>(queryKey)).toEqual(
		settings,
	);
});

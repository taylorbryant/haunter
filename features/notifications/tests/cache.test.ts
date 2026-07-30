import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
	listNotificationsQueryOptions,
	removeNotificationFromCache,
	restoreNotificationsCache,
} from "@/features/notifications/client/queries";
import type {
	ListNotificationsOutput,
	Notification,
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

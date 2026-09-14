import { expect, test } from "bun:test";
import {
	MutationObserver,
	QueryClient,
	QueryObserver,
} from "@tanstack/react-query";
import {
	commitNotificationReadCache,
	initializeNotificationTimezoneMutationOptions,
	invalidateNotifications,
	listNotificationsQueryOptions,
	markAllNotificationsReadInCache,
	markNotificationReadInCache,
	notificationSettingsQueryOptions,
	optimisticallyUpdateNotificationSettings,
	removeNotificationFromCache,
	restoreNotificationReadCache,
	restoreRemovedNotificationCache,
	updateNotificationSettingsMutationOptions,
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

const settings: NotificationSettings = {
	overdueTasksEnabled: true,
	taskAssignmentsEnabled: true,
	taskRemindersEnabled: true,
	timezone: "America/Chicago",
	timezoneConfigured: false,
	pushSupported: true,
	vapidPublicKey: "public-key",
};

test.each(["read", "read-all", "remove"] as const)(
	"notification %s releases a canceled fetch for reconciliation",
	async (operation) => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false, staleTime: Infinity } },
		});
		const queryKey = listNotificationsQueryOptions().queryKey;
		const initial: ListNotificationsOutput = {
			items: [notification],
			unreadCount: 1,
			nextCursor: null,
		};
		const fresh: ListNotificationsOutput = {
			items: [],
			unreadCount: 0,
			nextCursor: null,
		};
		let fetches = 0;
		let aborted = false;
		const observer = new QueryObserver(queryClient, {
			queryKey,
			initialData: initial,
			queryFn: ({ signal }): Promise<ListNotificationsOutput> => {
				if (++fetches > 1) return Promise.resolve(fresh);
				return new Promise((_resolve, reject) => {
					signal.addEventListener("abort", () => {
						aborted = true;
						reject(signal.reason);
					});
				});
			},
		});
		const unsubscribe = observer.subscribe(() => {});
		try {
			const pending = observer.refetch();
			if (operation === "read")
				await markNotificationReadInCache(queryClient, notification);
			else if (operation === "read-all")
				await markAllNotificationsReadInCache(queryClient);
			else await removeNotificationFromCache(queryClient, notification);
			expect(aborted).toBe(true);
			expect(queryClient.getQueryState(queryKey)?.fetchStatus).toBe("idle");
			await pending;
			await invalidateNotifications(queryClient);
			expect(fetches).toBe(2);
			expect(queryClient.getQueryData<ListNotificationsOutput>(queryKey)).toEqual(
				fresh,
			);
		} finally {
			unsubscribe();
			queryClient.clear();
		}
	},
);

test("settings mutations refresh preferences once without refreshing the notification inbox", async () => {
	const queryClient = new QueryClient();
	const queryKey = notificationSettingsQueryOptions().queryKey;
	const inboxKey = listNotificationsQueryOptions().queryKey;
	queryClient.setQueryData(queryKey, settings);
	queryClient.setQueryData(inboxKey, {
		items: [],
		unreadCount: 0,
		nextCursor: null,
	});
	const saved = {
		...settings,
		timezone: "America/New_York",
		timezoneConfigured: true,
	};
	const refetchStarted = Promise.withResolvers<void>();
	const refreshed = Promise.withResolvers<NotificationSettings>();
	let refetches = 0;
	const observer = new QueryObserver(queryClient, {
		queryKey,
		staleTime: Infinity,
		queryFn: () => {
			refetches++;
			expect(queryClient.getQueryData<NotificationSettings>(queryKey)).toEqual(
				saved,
			);
			refetchStarted.resolve();
			return refreshed.promise;
		},
	});
	const unsubscribe = observer.subscribe(() => {});
	try {
		const mutation = new MutationObserver(queryClient, {
			...updateNotificationSettingsMutationOptions({
				onSuccess: (result) => {
					queryClient.setQueryData(queryKey, result);
				},
			}),
			mutationFn: async () => saved,
		});
		const pending = mutation.mutate({ body: { timezone: saved.timezone } });
		await refetchStarted.promise;
		expect(mutation.getCurrentResult().isPending).toBe(true);
		refreshed.resolve(saved);
		await pending;
		expect(refetches).toBe(1);
		expect(queryClient.getQueryState(inboxKey)?.isInvalidated).toBe(false);
	} finally {
		unsubscribe();
		queryClient.clear();
	}
});

test("timezone initialization invalidates preferences only on success", async () => {
	const queryClient = new QueryClient();
	const queryKey = notificationSettingsQueryOptions().queryKey;
	queryClient.setQueryData(queryKey, settings);
	let fail = true;
	const failure = new Error("Unavailable");
	const mutation = new MutationObserver(queryClient, {
		...initializeNotificationTimezoneMutationOptions(),
		mutationFn: async () => {
			if (fail) throw failure;
			return { ...settings, timezoneConfigured: true };
		},
	});
	await expect(
		mutation.mutate({ body: { timezone: settings.timezone } }),
	).rejects.toBe(failure);
	expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(false);
	fail = false;
	await mutation.mutate({ body: { timezone: settings.timezone } });
	expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
	queryClient.clear();
});

test("notification updates skip infinite data while preserving read rollback", async () => {
	const queryClient = new QueryClient();
	const queryKey = listNotificationsQueryOptions().queryKey;
	const infiniteKey = [...queryKey, "infinite"];
	const data: ListNotificationsOutput = {
		items: [notification],
		unreadCount: 1,
		nextCursor: null,
	};
	const infiniteData = { pages: [data], pageParams: [null] };
	queryClient.setQueryData(queryKey, data);
	queryClient.setQueryData(infiniteKey, infiniteData);
	const read = await markNotificationReadInCache(queryClient, notification);
	expect(read).toHaveLength(1);
	restoreNotificationReadCache(queryClient, read);
	const readAll = await markAllNotificationsReadInCache(queryClient);
	restoreNotificationReadCache(queryClient, readAll);
	const removal = await removeNotificationFromCache(queryClient, notification);
	restoreRemovedNotificationCache(queryClient, removal);
	expect(queryClient.getQueryData<ListNotificationsOutput>(queryKey)).toEqual(
		data,
	);
	expect(queryClient.getQueryData<typeof infiniteData>(infiniteKey)).toBe(
		infiniteData,
	);
	queryClient.clear();
});

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

	restoreRemovedNotificationCache(queryClient, snapshot);
	expect(queryClient.getQueryData<ListNotificationsOutput>(visibleKey)).toEqual(
		visible,
	);
	expect(
		queryClient.getQueryData<ListNotificationsOutput>(smallerPageKey),
	).toEqual(smallerPage);
});

test("a failed task action restores only its notification, preserving other actions and read changes", async () => {
	const queryClient = new QueryClient();
	const queryKey = listNotificationsQueryOptions().queryKey;
	const successful = { ...notification, id: "successful" };
	const read = { ...notification, id: "read" };
	queryClient.setQueryData<ListNotificationsOutput>(queryKey, {
		items: [notification, successful, read],
		unreadCount: 3,
		nextCursor: null,
	});
	const failed = await removeNotificationFromCache(queryClient, notification);
	await removeNotificationFromCache(queryClient, successful);
	const markedRead = await markNotificationReadInCache(queryClient, read);
	commitNotificationReadCache(queryClient, markedRead);
	restoreRemovedNotificationCache(queryClient, failed);
	const restored = queryClient.getQueryData<ListNotificationsOutput>(queryKey);
	expect(restored?.items.map((item) => item.id)).toEqual([
		notification.id,
		read.id,
	]);
	expect(restored?.items[1]?.readAt).not.toBeNull();
	expect(restored?.unreadCount).toBe(1);
	queryClient.clear();
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

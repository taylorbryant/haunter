import type {
	Notification,
	NotificationPreferences,
	PushSubscriptionInput,
	TaskAssignedNotificationPayload,
	TaskOverdueNotificationPayload,
	TaskReminderNotificationPayload,
} from "@/features/notifications/schemas";

export type NotificationCursor = {
	createdAt: string;
	id: string;
};

export type NotificationPreferencesUpdate = {
	overdueTasksEnabled?: boolean;
	taskAssignmentsEnabled?: boolean;
	taskRemindersEnabled?: boolean;
	timezone?: string;
};

export type OverdueTaskCandidate = TaskOverdueNotificationPayload & {
	userId: string;
	workspaceId: string;
	timezone: string;
};

export type TaskAssignmentCandidate = TaskAssignedNotificationPayload & {
	userId: string;
	workspaceId: string;
	entityVersion: string;
};

export type TaskReminderCandidate = TaskReminderNotificationPayload & {
	userId: string;
	workspaceId: string;
	timezone: string;
	entityVersion: string;
	reminderConfiguredAt: string;
};

export type TaskReminderScanCursor = {
	dueDate: string;
	dueTime: string;
	createdAt: string;
	taskId: string;
};

export type TaskReminderCandidatePage = {
	items: TaskReminderCandidate[];
	nextCursor: TaskReminderScanCursor | null;
};

export type PendingPushNotification = Notification & {
	pushAttempts: number;
};

export type StoredPushSubscription = PushSubscriptionInput & {
	id: string;
	userId: string;
	createdAt: string;
	updatedAt: string;
};

export interface NotificationRepository {
	listByUser(
		userId: string,
		options: { cursor?: NotificationCursor; limit: number },
	): Promise<{ items: Notification[]; nextCursor: NotificationCursor | null }>;
	countUnread(userId: string): Promise<number>;
	markRead(userId: string, id: string): Promise<boolean>;
	markAllRead(userId: string): Promise<void>;
	getPreferences(userId: string): Promise<NotificationPreferences>;
	updatePreferences(
		userId: string,
		input: NotificationPreferencesUpdate,
	): Promise<NotificationPreferences>;
	initializeTimezone(
		userId: string,
		timezone: string,
	): Promise<NotificationPreferences>;
	findOverdueCandidates(
		cutoffDate: string,
		limit: number,
	): Promise<OverdueTaskCandidate[]>;
	findReminderCandidates(options: {
		fromDate: string;
		cutoffDate: string;
		limit: number;
		cursor?: TaskReminderScanCursor;
	}): Promise<TaskReminderCandidatePage>;
	createOverdue(
		candidate: OverdueTaskCandidate,
		createdAt: string,
	): Promise<Notification | null>;
	createTaskReminder(
		candidate: TaskReminderCandidate,
		createdAt: string,
	): Promise<Notification | null>;
	createTaskAssigned(
		candidate: TaskAssignmentCandidate,
		createdAt: string,
	): Promise<Notification | null>;
	listPendingPush(
		now: string,
		limit: number,
	): Promise<PendingPushNotification[]>;
	listValidReminderPush(ids: string[]): Promise<string[]>;
	claimPush(ids: string[], leaseUntil: string): Promise<boolean>;
	markPushDelivered(ids: string[], deliveredAt: string): Promise<void>;
	markPushSkipped(ids: string[]): Promise<void>;
	markPushFailed(ids: string[], nextAttemptAt: string | null): Promise<void>;
	listPushSubscriptions(userId: string): Promise<StoredPushSubscription[]>;
	findPushSubscription(
		userId: string,
		endpoint: string,
	): Promise<StoredPushSubscription | null>;
	upsertPushSubscription(
		userId: string,
		input: PushSubscriptionInput,
	): Promise<void>;
	deletePushSubscription(userId: string, endpoint: string): Promise<void>;
}

export type WebPushMessage = {
	title: string;
	body: string;
	url: string;
	tag: string;
	unreadCount: number;
};

export type WebPushResult =
	| { status: "sent" }
	| { status: "gone" }
	| { status: "failed"; reason: string };

export interface WebPushPort {
	isConfigured(): boolean;
	publicKey(): string | null;
	send(
		subscription: StoredPushSubscription,
		message: WebPushMessage,
	): Promise<WebPushResult>;
}

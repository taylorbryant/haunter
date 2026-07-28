import "@beignet/core/server-only";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import {
	and,
	desc,
	eq,
	getTableColumns,
	gte,
	inArray,
	isNotNull,
	isNull,
	lt,
	lte,
	ne,
	notExists,
	or,
	sql,
} from "drizzle-orm";
import type {
	NotificationCursor,
	NotificationRepository,
	OverdueTaskCandidate,
	StoredPushSubscription,
	TaskAssignmentCandidate,
	TaskReminderCandidate,
} from "@/features/notifications/ports";
import {
	type Notification,
	NotificationSchema,
	type PushSubscriptionInput,
} from "@/features/notifications/schemas";
import * as schema from "@/infra/db/schema";

type NotificationRow = typeof schema.notifications.$inferSelect;
const notificationColumns = getTableColumns(schema.notifications);

function toNotification(row: NotificationRow): Notification {
	return NotificationSchema.parse({
		id: row.id,
		userId: row.userId,
		workspaceId: row.workspaceId,
		kind: row.kind,
		entityId: row.entityId,
		entityVersion: row.entityVersion,
		payload: JSON.parse(row.payload),
		readAt: row.readAt,
		createdAt: row.createdAt,
	});
}

function toSubscription(
	row: typeof schema.pushSubscriptions.$inferSelect,
): StoredPushSubscription {
	return {
		id: row.id,
		userId: row.userId,
		endpoint: row.endpoint,
		expirationTime: row.expirationTime,
		keys: { p256dh: row.p256dh, auth: row.auth },
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function taskReminderEntityVersion() {
	return sql<string>`${schema.tasks.dueDate} || ':' ||
		COALESCE(${schema.tasks.dueTime}, '') || ':' ||
		${schema.tasks.reminderOffsetMinutes} || ':' ||
		${schema.tasks.assigneeId} || ':' ||
		${schema.tasks.reminderConfiguredAt}`;
}

export function createDrizzleNotificationRepository(
	db: DrizzleSqliteDatabase<typeof schema>,
): NotificationRepository {
	async function readPreferences(userId: string) {
		const [row] = await db
			.select()
			.from(schema.notificationPreferences)
			.where(eq(schema.notificationPreferences.userId, userId))
			.limit(1);
		return row
			? {
					overdueTasksEnabled: row.overdueTasksEnabled,
					taskAssignmentsEnabled: row.taskAssignmentsEnabled,
					taskRemindersEnabled: row.taskRemindersEnabled,
					timezone: row.timezone,
					timezoneConfigured: row.timezoneConfigured,
				}
			: {
					overdueTasksEnabled: true,
					taskAssignmentsEnabled: true,
					taskRemindersEnabled: true,
					timezone: "UTC",
					timezoneConfigured: false,
				};
	}

	return {
		async listByUser(userId, options) {
			const cursorCondition = options.cursor
				? or(
						lt(schema.notifications.createdAt, options.cursor.createdAt),
						and(
							eq(schema.notifications.createdAt, options.cursor.createdAt),
							lt(schema.notifications.id, options.cursor.id),
						),
					)
				: undefined;
			const rows = await db
				.select(notificationColumns)
				.from(schema.notifications)
				.innerJoin(
					schema.member,
					and(
						eq(schema.member.userId, schema.notifications.userId),
						eq(schema.member.organizationId, schema.notifications.workspaceId),
					),
				)
				.where(
					cursorCondition
						? and(eq(schema.notifications.userId, userId), cursorCondition)
						: eq(schema.notifications.userId, userId),
				)
				.orderBy(
					desc(schema.notifications.createdAt),
					desc(schema.notifications.id),
				)
				.limit(options.limit + 1);

			const page = rows.slice(0, options.limit);
			const last = page.at(-1);
			return {
				items: page.map(toNotification),
				nextCursor:
					rows.length > options.limit && last
						? { createdAt: last.createdAt, id: last.id }
						: null,
			};
		},

		async countUnread(userId) {
			const [row] = await db
				.select({ count: sql<number>`count(*)` })
				.from(schema.notifications)
				.innerJoin(
					schema.member,
					and(
						eq(schema.member.userId, schema.notifications.userId),
						eq(schema.member.organizationId, schema.notifications.workspaceId),
					),
				)
				.where(
					and(
						eq(schema.notifications.userId, userId),
						isNull(schema.notifications.readAt),
					),
				);
			return Number(row?.count ?? 0);
		},

		async markRead(userId, id) {
			const rows = await db
				.update(schema.notifications)
				.set({ readAt: new Date().toISOString() })
				.where(
					and(
						eq(schema.notifications.id, id),
						eq(schema.notifications.userId, userId),
						inArray(
							schema.notifications.workspaceId,
							db
								.select({ organizationId: schema.member.organizationId })
								.from(schema.member)
								.where(eq(schema.member.userId, userId)),
						),
					),
				)
				.returning({ id: schema.notifications.id });
			return rows.length > 0;
		},

		async markAllRead(userId) {
			await db
				.update(schema.notifications)
				.set({ readAt: new Date().toISOString() })
				.where(
					and(
						eq(schema.notifications.userId, userId),
						isNull(schema.notifications.readAt),
						inArray(
							schema.notifications.workspaceId,
							db
								.select({ organizationId: schema.member.organizationId })
								.from(schema.member)
								.where(eq(schema.member.userId, userId)),
						),
					),
				);
		},

		async getPreferences(userId) {
			return readPreferences(userId);
		},

		async updatePreferences(userId, input) {
			const current = await readPreferences(userId);
			const now = new Date().toISOString();
			const values = {
				overdueTasksEnabled:
					input.overdueTasksEnabled ?? current.overdueTasksEnabled,
				taskAssignmentsEnabled:
					input.taskAssignmentsEnabled ?? current.taskAssignmentsEnabled,
				taskRemindersEnabled:
					input.taskRemindersEnabled ?? current.taskRemindersEnabled,
				timezone: input.timezone ?? current.timezone,
				timezoneConfigured:
					input.timezone === undefined ? current.timezoneConfigured : true,
			};
			const [row] = await db
				.insert(schema.notificationPreferences)
				.values({ userId, ...values, createdAt: now, updatedAt: now })
				.onConflictDoUpdate({
					target: schema.notificationPreferences.userId,
					set: { ...values, updatedAt: now },
				})
				.returning();
			if (!row) throw new Error("Failed to update notification preferences");
			return {
				overdueTasksEnabled: row.overdueTasksEnabled,
				taskAssignmentsEnabled: row.taskAssignmentsEnabled,
				taskRemindersEnabled: row.taskRemindersEnabled,
				timezone: row.timezone,
				timezoneConfigured: row.timezoneConfigured,
			};
		},

		async initializeTimezone(userId, timezone) {
			const now = new Date().toISOString();
			await db
				.insert(schema.notificationPreferences)
				.values({
					userId,
					overdueTasksEnabled: true,
					taskAssignmentsEnabled: true,
					taskRemindersEnabled: true,
					timezone,
					timezoneConfigured: true,
					createdAt: now,
					updatedAt: now,
				})
				.onConflictDoNothing();
			await db
				.update(schema.notificationPreferences)
				.set({ timezone, timezoneConfigured: true, updatedAt: now })
				.where(
					and(
						eq(schema.notificationPreferences.userId, userId),
						eq(schema.notificationPreferences.timezoneConfigured, false),
					),
				);
			return readPreferences(userId);
		},

		async findOverdueCandidates(cutoffDate, limit) {
			const entityVersion = sql<string>`CASE
				WHEN ${schema.tasks.dueTime} IS NULL
				THEN ${schema.tasks.dueDate} || ':' || ${schema.tasks.assigneeId}
				ELSE ${schema.tasks.dueDate} || ':' || ${schema.tasks.dueTime} || ':' || ${schema.tasks.assigneeId}
			END`;
			const rows = await db
				.select({
					taskId: schema.tasks.id,
					title: schema.tasks.title,
					dueDate: schema.tasks.dueDate,
					dueTime: schema.tasks.dueTime,
					pageId: schema.tasks.pageId,
					sourceBlockId: schema.tasks.sourceBlockId,
					userId: schema.tasks.assigneeId,
					workspaceId: schema.tasks.workspaceId,
					timezone: sql<string>`COALESCE(${schema.notificationPreferences.timezone}, 'UTC')`,
				})
				.from(schema.tasks)
				.innerJoin(
					schema.member,
					and(
						eq(schema.member.userId, schema.tasks.assigneeId),
						eq(schema.member.organizationId, schema.tasks.workspaceId),
					),
				)
				.leftJoin(schema.pages, eq(schema.tasks.pageId, schema.pages.id))
				.leftJoin(
					schema.notificationPreferences,
					eq(schema.tasks.assigneeId, schema.notificationPreferences.userId),
				)
				.leftJoin(
					schema.notifications,
					and(
						eq(schema.notifications.kind, "task.overdue"),
						eq(schema.notifications.entityId, schema.tasks.id),
						eq(schema.notifications.userId, schema.tasks.assigneeId),
						eq(schema.notifications.entityVersion, entityVersion),
					),
				)
				.where(
					and(
						eq(schema.tasks.completed, false),
						isNotNull(schema.tasks.dueDate),
						isNotNull(schema.tasks.assigneeId),
						lt(schema.tasks.dueDate, cutoffDate),
						or(isNull(schema.tasks.pageId), isNull(schema.pages.deletedAt)),
						or(
							isNull(schema.notificationPreferences.userId),
							ne(schema.notificationPreferences.overdueTasksEnabled, false),
						),
						notExists(
							db
								.select({ id: schema.notifications.id })
								.from(schema.notifications)
								.where(
									and(
										eq(schema.notifications.kind, "task.reminder"),
										eq(schema.notifications.entityId, schema.tasks.id),
										eq(schema.notifications.userId, schema.tasks.assigneeId),
										eq(
											schema.notifications.entityVersion,
											taskReminderEntityVersion(),
										),
									),
								),
						),
						isNull(schema.notifications.id),
					),
				)
				.orderBy(
					schema.tasks.dueDate,
					schema.tasks.dueTime,
					schema.tasks.createdAt,
				)
				.limit(limit);

			return rows.filter(
				(row): row is OverdueTaskCandidate =>
					row.dueDate !== null && row.userId !== null,
			);
		},

		async findReminderCandidates(options) {
			const { fromDate, cutoffDate, limit, cursor } = options;
			const entityVersion = taskReminderEntityVersion();
			const rows = await db
				.select({
					taskId: schema.tasks.id,
					title: schema.tasks.title,
					dueDate: schema.tasks.dueDate,
					dueTime: schema.tasks.dueTime,
					reminderOffsetMinutes: schema.tasks.reminderOffsetMinutes,
					pageId: schema.tasks.pageId,
					sourceBlockId: schema.tasks.sourceBlockId,
					userId: schema.tasks.assigneeId,
					workspaceId: schema.tasks.workspaceId,
					timezone: sql<string>`COALESCE(${schema.notificationPreferences.timezone}, 'UTC')`,
					entityVersion,
					reminderConfiguredAt: schema.tasks.reminderConfiguredAt,
					createdAt: schema.tasks.createdAt,
				})
				.from(schema.tasks)
				.innerJoin(
					schema.member,
					and(
						eq(schema.member.userId, schema.tasks.assigneeId),
						eq(schema.member.organizationId, schema.tasks.workspaceId),
					),
				)
				.leftJoin(schema.pages, eq(schema.tasks.pageId, schema.pages.id))
				.leftJoin(
					schema.notificationPreferences,
					eq(schema.tasks.assigneeId, schema.notificationPreferences.userId),
				)
				.leftJoin(
					schema.notifications,
					and(
						eq(schema.notifications.kind, "task.reminder"),
						eq(schema.notifications.entityId, schema.tasks.id),
						eq(schema.notifications.userId, schema.tasks.assigneeId),
						eq(schema.notifications.entityVersion, entityVersion),
					),
				)
				.where(
					and(
						eq(schema.tasks.completed, false),
						isNotNull(schema.tasks.dueDate),
						isNotNull(schema.tasks.assigneeId),
						isNotNull(schema.tasks.reminderOffsetMinutes),
						isNotNull(schema.tasks.reminderConfiguredAt),
						inArray(schema.tasks.reminderOffsetMinutes, [0, 15, 60, 1_440]),
						gte(schema.tasks.dueDate, fromDate),
						lte(schema.tasks.dueDate, cutoffDate),
						or(isNull(schema.tasks.pageId), isNull(schema.pages.deletedAt)),
						or(
							isNull(schema.notificationPreferences.userId),
							ne(schema.notificationPreferences.taskRemindersEnabled, false),
						),
						isNull(schema.notifications.id),
						cursor
							? sql`(
								${schema.tasks.dueDate},
								COALESCE(${schema.tasks.dueTime}, ''),
								${schema.tasks.createdAt},
								${schema.tasks.id}
							) > (
								${cursor.dueDate},
								${cursor.dueTime},
								${cursor.createdAt},
								${cursor.taskId}
							)`
							: undefined,
					),
				)
				.orderBy(
					schema.tasks.dueDate,
					sql`COALESCE(${schema.tasks.dueTime}, '')`,
					schema.tasks.createdAt,
					schema.tasks.id,
				)
				.limit(limit + 1);

			const page = rows.slice(0, limit);
			const items = page.filter(
				(
					row,
				): row is TaskReminderCandidate & {
					createdAt: string;
				} =>
					row.dueDate !== null &&
					row.userId !== null &&
					(row.reminderOffsetMinutes === 0 ||
						row.reminderOffsetMinutes === 15 ||
						row.reminderOffsetMinutes === 60 ||
						row.reminderOffsetMinutes === 1_440) &&
					row.reminderConfiguredAt !== null,
			);
			const last = page.at(-1);
			return {
				items,
				nextCursor:
					rows.length > limit && last?.dueDate
						? {
								dueDate: last.dueDate,
								dueTime: last.dueTime ?? "",
								createdAt: last.createdAt,
								taskId: last.taskId,
							}
						: null,
			};
		},

		async createOverdue(candidate, createdAt) {
			const [row] = await db
				.insert(schema.notifications)
				.values({
					id: crypto.randomUUID(),
					userId: candidate.userId,
					workspaceId: candidate.workspaceId,
					kind: "task.overdue",
					entityId: candidate.taskId,
					entityVersion: candidate.dueTime
						? `${candidate.dueDate}:${candidate.dueTime}:${candidate.userId}`
						: `${candidate.dueDate}:${candidate.userId}`,
					payload: JSON.stringify({
						taskId: candidate.taskId,
						title: candidate.title,
						dueDate: candidate.dueDate,
						dueTime: candidate.dueTime,
						pageId: candidate.pageId,
						sourceBlockId: candidate.sourceBlockId,
					}),
					createdAt,
				})
				.onConflictDoNothing()
				.returning();
			return row ? toNotification(row) : null;
		},

		async createTaskReminder(candidate, createdAt) {
			const id = crypto.randomUUID();
			const result = await db.run(sql`
				INSERT OR IGNORE INTO ${schema.notifications} (
					id,
					user_id,
					workspace_id,
					kind,
					entity_id,
					entity_version,
					payload,
					created_at
				)
				SELECT
					${id},
					${schema.tasks.assigneeId},
					${schema.tasks.workspaceId},
					'task.reminder',
					${schema.tasks.id},
					${taskReminderEntityVersion()},
					json_object(
						'taskId', ${schema.tasks.id},
						'title', ${schema.tasks.title},
						'dueDate', ${schema.tasks.dueDate},
						'dueTime', ${schema.tasks.dueTime},
						'reminderOffsetMinutes', ${schema.tasks.reminderOffsetMinutes},
						'pageId', ${schema.tasks.pageId},
						'sourceBlockId', ${schema.tasks.sourceBlockId}
					),
					${createdAt}
				FROM ${schema.tasks}
				INNER JOIN ${schema.member}
					ON ${schema.member.userId} = ${schema.tasks.assigneeId}
					AND ${schema.member.organizationId} = ${schema.tasks.workspaceId}
				LEFT JOIN ${schema.pages}
					ON ${schema.pages.id} = ${schema.tasks.pageId}
				LEFT JOIN ${schema.notificationPreferences}
					ON ${schema.notificationPreferences.userId} = ${schema.tasks.assigneeId}
				WHERE ${schema.tasks.id} = ${candidate.taskId}
					AND ${schema.tasks.workspaceId} = ${candidate.workspaceId}
					AND ${schema.tasks.assigneeId} = ${candidate.userId}
					AND ${schema.tasks.completed} = false
					AND ${schema.tasks.dueDate} IS NOT NULL
					AND ${schema.tasks.reminderOffsetMinutes} IN (0, 15, 60, 1440)
					AND ${schema.tasks.reminderConfiguredAt} IS NOT NULL
					AND ${taskReminderEntityVersion()} = ${candidate.entityVersion}
					AND (
						${schema.tasks.pageId} IS NULL
						OR ${schema.pages.deletedAt} IS NULL
					)
					AND (
						${schema.notificationPreferences.userId} IS NULL
						OR ${schema.notificationPreferences.taskRemindersEnabled} != false
					)
					AND COALESCE(
						${schema.notificationPreferences.timezone},
						'UTC'
					) = ${candidate.timezone}
			`);
			if (result.rowsAffected === 0) return null;
			const [row] = await db
				.select()
				.from(schema.notifications)
				.where(eq(schema.notifications.id, id))
				.limit(1);
			return row ? toNotification(row) : null;
		},

		async createTaskAssigned(
			candidate: TaskAssignmentCandidate,
			createdAt: string,
		) {
			const [row] = await db
				.insert(schema.notifications)
				.values({
					id: crypto.randomUUID(),
					userId: candidate.userId,
					workspaceId: candidate.workspaceId,
					kind: "task.assigned",
					entityId: candidate.taskId,
					entityVersion: candidate.entityVersion,
					payload: JSON.stringify({
						taskId: candidate.taskId,
						title: candidate.title,
						assignedByUserId: candidate.assignedByUserId,
						assignedByName: candidate.assignedByName,
						pageId: candidate.pageId,
						sourceBlockId: candidate.sourceBlockId,
					}),
					createdAt,
				})
				.onConflictDoNothing()
				.returning();
			return row ? toNotification(row) : null;
		},

		async listPendingPush(now, limit) {
			const rows = await db
				.select(notificationColumns)
				.from(schema.notifications)
				.innerJoin(
					schema.member,
					and(
						eq(schema.member.userId, schema.notifications.userId),
						eq(schema.member.organizationId, schema.notifications.workspaceId),
					),
				)
				.where(
					and(
						lt(schema.notifications.pushAttempts, 3),
						or(
							eq(schema.notifications.pushState, "pending"),
							and(
								eq(schema.notifications.pushState, "sending"),
								lte(schema.notifications.pushLeaseUntil, now),
							),
						),
						or(
							isNull(schema.notifications.pushNextAttemptAt),
							lte(schema.notifications.pushNextAttemptAt, now),
						),
					),
				)
				.orderBy(schema.notifications.createdAt)
				.limit(limit);
			return rows.map((row) => ({
				...toNotification(row),
				pushAttempts: row.pushAttempts,
			}));
		},

		async listValidReminderPush(ids) {
			if (ids.length === 0) return [];
			const rows = await db
				.select({ id: schema.notifications.id })
				.from(schema.notifications)
				.innerJoin(
					schema.tasks,
					and(
						eq(schema.tasks.id, schema.notifications.entityId),
						eq(schema.tasks.assigneeId, schema.notifications.userId),
						eq(schema.tasks.workspaceId, schema.notifications.workspaceId),
						eq(schema.notifications.entityVersion, taskReminderEntityVersion()),
					),
				)
				.innerJoin(
					schema.member,
					and(
						eq(schema.member.userId, schema.notifications.userId),
						eq(schema.member.organizationId, schema.notifications.workspaceId),
					),
				)
				.leftJoin(schema.pages, eq(schema.tasks.pageId, schema.pages.id))
				.leftJoin(
					schema.notificationPreferences,
					eq(
						schema.notifications.userId,
						schema.notificationPreferences.userId,
					),
				)
				.where(
					and(
						inArray(schema.notifications.id, ids),
						eq(schema.notifications.kind, "task.reminder"),
						eq(schema.tasks.completed, false),
						isNotNull(schema.tasks.dueDate),
						isNotNull(schema.tasks.reminderOffsetMinutes),
						isNotNull(schema.tasks.reminderConfiguredAt),
						or(isNull(schema.tasks.pageId), isNull(schema.pages.deletedAt)),
						or(
							isNull(schema.notificationPreferences.userId),
							ne(schema.notificationPreferences.taskRemindersEnabled, false),
						),
					),
				);
			return rows.map((row) => row.id);
		},

		async claimPush(ids, leaseUntil) {
			if (ids.length === 0) return false;
			const rows = await db
				.update(schema.notifications)
				.set({
					pushState: "sending",
					pushLeaseUntil: leaseUntil,
					pushAttempts: sql`${schema.notifications.pushAttempts} + 1`,
				})
				.where(
					and(
						inArray(schema.notifications.id, ids),
						or(
							eq(schema.notifications.pushState, "pending"),
							and(
								eq(schema.notifications.pushState, "sending"),
								lte(
									schema.notifications.pushLeaseUntil,
									new Date().toISOString(),
								),
							),
						),
					),
				)
				.returning({ id: schema.notifications.id });
			return rows.length === ids.length;
		},

		async markPushDelivered(ids, deliveredAt) {
			if (ids.length === 0) return;
			await db
				.update(schema.notifications)
				.set({
					pushState: "delivered",
					pushDeliveredAt: deliveredAt,
					pushLeaseUntil: null,
					pushNextAttemptAt: null,
				})
				.where(inArray(schema.notifications.id, ids));
		},

		async markPushSkipped(ids) {
			if (ids.length === 0) return;
			await db
				.update(schema.notifications)
				.set({ pushState: "skipped", pushLeaseUntil: null })
				.where(inArray(schema.notifications.id, ids));
		},

		async markPushFailed(ids, nextAttemptAt) {
			if (ids.length === 0) return;
			await db
				.update(schema.notifications)
				.set({
					pushState: nextAttemptAt ? "pending" : "failed",
					pushLeaseUntil: null,
					pushNextAttemptAt: nextAttemptAt,
				})
				.where(inArray(schema.notifications.id, ids));
		},

		async listPushSubscriptions(userId) {
			const rows = await db
				.select()
				.from(schema.pushSubscriptions)
				.where(eq(schema.pushSubscriptions.userId, userId));
			return rows.map(toSubscription);
		},

		async findPushSubscription(userId, endpoint) {
			const [row] = await db
				.select()
				.from(schema.pushSubscriptions)
				.where(
					and(
						eq(schema.pushSubscriptions.userId, userId),
						eq(schema.pushSubscriptions.endpoint, endpoint),
					),
				)
				.limit(1);
			return row ? toSubscription(row) : null;
		},

		async upsertPushSubscription(userId, input: PushSubscriptionInput) {
			const now = new Date().toISOString();
			await db
				.insert(schema.pushSubscriptions)
				.values({
					id: crypto.randomUUID(),
					userId,
					endpoint: input.endpoint,
					expirationTime: input.expirationTime ?? null,
					p256dh: input.keys.p256dh,
					auth: input.keys.auth,
					createdAt: now,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: schema.pushSubscriptions.endpoint,
					set: {
						userId,
						expirationTime: input.expirationTime ?? null,
						p256dh: input.keys.p256dh,
						auth: input.keys.auth,
						updatedAt: now,
					},
				});
		},

		async deletePushSubscription(userId, endpoint) {
			await db
				.delete(schema.pushSubscriptions)
				.where(
					and(
						eq(schema.pushSubscriptions.userId, userId),
						eq(schema.pushSubscriptions.endpoint, endpoint),
					),
				);
		},
	};
}

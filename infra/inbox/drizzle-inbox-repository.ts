import "@beignet/core/server-only";
import { tenantScopeId } from "@beignet/core/ports";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { and, desc, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import type {
	InboxItemRecord,
	InboxRepository,
	NewInboxItem,
} from "@/features/inbox/ports";
import type { InboxItem } from "@/features/inbox/schemas";
import type { PageMeta } from "@/features/pages/schemas";
import type { Task } from "@/features/tasks/schemas";
import * as schema from "@/infra/db/schema";
import { assertPageInScope } from "@/infra/db/tenant-scope";

type InboxRow = typeof schema.inboxItems.$inferSelect;
type PageRow = typeof schema.pages.$inferSelect;
type TaskRow = typeof schema.tasks.$inferSelect;

function toRecord(row: InboxRow): InboxItemRecord {
	return row;
}

function toPageMeta(row: PageRow): PageMeta {
	return {
		id: row.id,
		userId: row.userId,
		workspaceId: row.workspaceId,
		parentPageId: row.parentPageId,
		title: row.title,
		icon: row.icon,
		position: row.position,
		deletedAt: row.deletedAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function toTask(row: TaskRow): Task {
	return {
		id: row.id,
		userId: row.userId,
		workspaceId: row.workspaceId,
		pageId: row.pageId,
		sourceBlockId: row.sourceBlockId,
		title: row.title,
		completed: row.completed,
		dueDate: row.dueDate,
		dueTime: row.dueTime,
		assigneeId: row.assigneeId,
		completedAt: row.completedAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export function createDrizzleInboxRepository(
	db: DrizzleSqliteDatabase<typeof schema>,
): InboxRepository {
	return {
		async listForUser(scope, userId, options) {
			const workspaceId = tenantScopeId(scope);
			const cursorCondition = options.cursor
				? or(
						lt(schema.inboxItems.createdAt, options.cursor.createdAt),
						and(
							eq(schema.inboxItems.createdAt, options.cursor.createdAt),
							lt(schema.inboxItems.id, options.cursor.id),
						),
					)
				: undefined;
			const rows = await db
				.select({
					inboxItem: schema.inboxItems,
					page: schema.pages,
					task: schema.tasks,
				})
				.from(schema.inboxItems)
				.leftJoin(
					schema.pages,
					and(
						eq(schema.inboxItems.pageId, schema.pages.id),
						eq(schema.inboxItems.workspaceId, schema.pages.workspaceId),
					),
				)
				.leftJoin(
					schema.tasks,
					and(
						eq(schema.inboxItems.taskId, schema.tasks.id),
						eq(schema.inboxItems.workspaceId, schema.tasks.workspaceId),
					),
				)
				.where(
					and(
						eq(schema.inboxItems.workspaceId, workspaceId),
						eq(schema.inboxItems.userId, userId),
						cursorCondition,
						or(
							and(
								eq(schema.inboxItems.kind, "page"),
								isNotNull(schema.inboxItems.pageId),
								isNotNull(schema.pages.id),
								isNull(schema.pages.deletedAt),
							),
							and(
								eq(schema.inboxItems.kind, "task"),
								isNotNull(schema.inboxItems.taskId),
								isNotNull(schema.tasks.id),
								eq(schema.tasks.completed, false),
							),
						),
					),
				)
				.orderBy(desc(schema.inboxItems.createdAt), desc(schema.inboxItems.id))
				.limit(options.limit + 1);

			const pageRows = rows.slice(0, options.limit);
			const items = pageRows.flatMap<InboxItem>((row) => {
				if (row.inboxItem.kind === "page" && row.page) {
					return [
						{
							id: row.inboxItem.id,
							workspaceId: row.inboxItem.workspaceId,
							kind: "page",
							page: toPageMeta(row.page),
							task: null,
							createdAt: row.inboxItem.createdAt,
						},
					];
				}
				if (row.inboxItem.kind === "task" && row.task) {
					return [
						{
							id: row.inboxItem.id,
							workspaceId: row.inboxItem.workspaceId,
							kind: "task",
							page: null,
							task: toTask(row.task),
							createdAt: row.inboxItem.createdAt,
						},
					];
				}
				return [];
			});
			const last = pageRows.at(-1)?.inboxItem;
			return {
				items,
				nextCursor:
					rows.length > options.limit && last
						? { createdAt: last.createdAt, id: last.id }
						: null,
			};
		},
		async findForUser(scope, userId, id) {
			const [row] = await db
				.select()
				.from(schema.inboxItems)
				.where(
					and(
						eq(schema.inboxItems.id, id),
						eq(schema.inboxItems.workspaceId, tenantScopeId(scope)),
						eq(schema.inboxItems.userId, userId),
					),
				)
				.limit(1);
			return row ? toRecord(row) : null;
		},
		async create(scope, input: NewInboxItem) {
			const workspaceId = tenantScopeId(scope);
			if (input.kind === "page") {
				await assertPageInScope(db, scope, input.pageId);
			} else {
				const [task] = await db
					.select({ id: schema.tasks.id })
					.from(schema.tasks)
					.where(
						and(
							eq(schema.tasks.id, input.taskId),
							eq(schema.tasks.workspaceId, workspaceId),
						),
					)
					.limit(1);
				if (!task) {
					throw new Error(`Task ${input.taskId} is outside the tenant scope`);
				}
			}

			const [row] = await db
				.insert(schema.inboxItems)
				.values({
					id: crypto.randomUUID(),
					workspaceId,
					createdAt: new Date().toISOString(),
					...input,
				})
				.returning();
			if (!row) throw new Error("Failed to create inbox item");
			return toRecord(row);
		},
		async deleteForUser(scope, userId, id) {
			await db
				.delete(schema.inboxItems)
				.where(
					and(
						eq(schema.inboxItems.id, id),
						eq(schema.inboxItems.workspaceId, tenantScopeId(scope)),
						eq(schema.inboxItems.userId, userId),
					),
				);
		},
		async deleteByPageIds(scope, pageIds) {
			if (pageIds.length === 0) return;
			await db
				.delete(schema.inboxItems)
				.where(
					and(
						eq(schema.inboxItems.workspaceId, tenantScopeId(scope)),
						inArray(schema.inboxItems.pageId, pageIds),
					),
				);
		},
		async deleteByTaskIds(scope, taskIds) {
			if (taskIds.length === 0) return;
			await db
				.delete(schema.inboxItems)
				.where(
					and(
						eq(schema.inboxItems.workspaceId, tenantScopeId(scope)),
						inArray(schema.inboxItems.taskId, taskIds),
					),
				);
		},
	};
}

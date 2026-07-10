import "@beignet/core/server-only";
import { tenantScopeId } from "@beignet/core/ports";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import type {
	ListTasksOptions,
	NewTask,
	TaskRepository,
	UpdateTaskData,
} from "@/features/tasks/ports";
import type { Task, TaskFilter, TaskWithPage } from "@/features/tasks/schemas";
import * as schema from "@/infra/db/schema";
import { assertPageInScope } from "@/infra/db/tenant-scope";

type TaskRow = typeof schema.tasks.$inferSelect;

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
		assigneeId: row.assigneeId,
		completedAt: row.completedAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export function createDrizzleTaskRepository(
	db: DrizzleSqliteDatabase<typeof schema>,
): TaskRepository {
	return {
		async listByWorkspace(
			scope,
			filter: TaskFilter,
			options: ListTasksOptions = {},
		): Promise<TaskWithPage[]> {
			const workspaceId = tenantScopeId(scope);
			const conditions = [
				eq(schema.tasks.workspaceId, workspaceId),
				// Hide tasks whose source page is in the trash. Standalone tasks
				// produce a NULL join row, which passes this check.
				isNull(schema.pages.deletedAt),
			];
			if (filter === "open") {
				conditions.push(eq(schema.tasks.completed, false));
			} else if (filter === "completed") {
				conditions.push(eq(schema.tasks.completed, true));
			}
			if (options.assigneeId) {
				conditions.push(eq(schema.tasks.assigneeId, options.assigneeId));
			}
			if (options.dueOnOrBefore) {
				conditions.push(lte(schema.tasks.dueDate, options.dueOnOrBefore));
			}

			let query = db
				.select({
					task: schema.tasks,
					pageTitle: schema.pages.title,
					// OTP sign-ups can have an empty name; fall back to the email.
					assigneeName: sql<
						string | null
					>`COALESCE(NULLIF(${schema.user.name}, ''), ${schema.user.email})`,
				})
				.from(schema.tasks)
				.leftJoin(
					schema.pages,
					and(
						eq(schema.tasks.pageId, schema.pages.id),
						eq(schema.tasks.workspaceId, schema.pages.workspaceId),
					),
				)
				.leftJoin(schema.user, eq(schema.tasks.assigneeId, schema.user.id))
				.where(and(...conditions))
				.orderBy(
					// Due tasks first (soonest first), then undated by creation.
					sql`${schema.tasks.dueDate} IS NULL`,
					asc(schema.tasks.dueDate),
					asc(schema.tasks.createdAt),
				)
				.$dynamic();
			if (options.limit !== undefined) {
				query = query.limit(options.limit);
			}
			const rows = await query;

			return rows.map((row) => ({
				...toTask(row.task),
				pageTitle: row.pageTitle ?? null,
				assigneeName: row.assigneeName ?? null,
			}));
		},
		async listByPage(scope, pageId: string) {
			const rows = await db
				.select()
				.from(schema.tasks)
				.where(
					and(
						eq(schema.tasks.pageId, pageId),
						eq(schema.tasks.workspaceId, tenantScopeId(scope)),
					),
				);

			return rows.map(toTask);
		},
		async findById(scope, id: string) {
			const [row] = await db
				.select()
				.from(schema.tasks)
				.where(
					and(
						eq(schema.tasks.id, id),
						eq(schema.tasks.workspaceId, tenantScopeId(scope)),
					),
				)
				.limit(1);

			return row ? toTask(row) : null;
		},
		async create(scope, input: NewTask) {
			if (input.pageId !== null) {
				await assertPageInScope(db, scope, input.pageId);
			}
			const now = new Date().toISOString();
			const task = {
				id: crypto.randomUUID(),
				userId: input.userId,
				workspaceId: tenantScopeId(scope),
				pageId: input.pageId,
				sourceBlockId: input.sourceBlockId,
				title: input.title,
				completed: input.completed,
				dueDate: input.dueDate,
				assigneeId: input.assigneeId,
				completedAt: input.completedAt,
				createdAt: now,
				updatedAt: now,
			};
			const [row] = await db.insert(schema.tasks).values(task).returning();

			if (!row) {
				throw new Error("Failed to create task");
			}

			return toTask(row);
		},
		async update(scope, id: string, input: UpdateTaskData) {
			const [row] = await db
				.update(schema.tasks)
				.set({ ...input, updatedAt: new Date().toISOString() })
				.where(
					and(
						eq(schema.tasks.id, id),
						eq(schema.tasks.workspaceId, tenantScopeId(scope)),
					),
				)
				.returning();

			if (!row) {
				throw new Error(`Failed to update task ${id}`);
			}

			return toTask(row);
		},
		async delete(scope, id: string) {
			await db
				.delete(schema.tasks)
				.where(
					and(
						eq(schema.tasks.id, id),
						eq(schema.tasks.workspaceId, tenantScopeId(scope)),
					),
				);
		},
		async deleteByIds(scope, ids: string[]) {
			if (ids.length === 0) return;
			await db
				.delete(schema.tasks)
				.where(
					and(
						inArray(schema.tasks.id, ids),
						eq(schema.tasks.workspaceId, tenantScopeId(scope)),
					),
				);
		},
		async deleteByPageIds(scope, pageIds: string[]) {
			if (pageIds.length === 0) return;
			await db
				.delete(schema.tasks)
				.where(
					and(
						inArray(schema.tasks.pageId, pageIds),
						eq(schema.tasks.workspaceId, tenantScopeId(scope)),
					),
				);
		},
	};
}

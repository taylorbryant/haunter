import "@beignet/core/server-only";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type {
	NewTask,
	TaskRepository,
	UpdateTaskData,
} from "@/features/tasks/ports";
import type { Task, TaskFilter, TaskWithPage } from "@/features/tasks/schemas";
import * as schema from "@/infra/db/schema";

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
			userId: string,
			workspaceId: string,
			filter: TaskFilter,
		): Promise<TaskWithPage[]> {
			const conditions = [
				eq(schema.tasks.userId, userId),
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

			const rows = await db
				.select({
					task: schema.tasks,
					pageTitle: schema.pages.title,
				})
				.from(schema.tasks)
				.leftJoin(schema.pages, eq(schema.tasks.pageId, schema.pages.id))
				.where(and(...conditions))
				.orderBy(
					// Due tasks first (soonest first), then undated by creation.
					sql`${schema.tasks.dueDate} IS NULL`,
					asc(schema.tasks.dueDate),
					asc(schema.tasks.createdAt),
				);

			return rows.map((row) => ({
				...toTask(row.task),
				pageTitle: row.pageTitle ?? null,
			}));
		},
		async listByPage(pageId: string) {
			const rows = await db
				.select()
				.from(schema.tasks)
				.where(eq(schema.tasks.pageId, pageId));

			return rows.map(toTask);
		},
		async findById(id: string) {
			const [row] = await db
				.select()
				.from(schema.tasks)
				.where(eq(schema.tasks.id, id))
				.limit(1);

			return row ? toTask(row) : null;
		},
		async create(input: NewTask) {
			const now = new Date().toISOString();
			const task = {
				id: crypto.randomUUID(),
				userId: input.userId,
				workspaceId: input.workspaceId,
				pageId: input.pageId,
				sourceBlockId: input.sourceBlockId,
				title: input.title,
				completed: input.completed,
				dueDate: input.dueDate,
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
		async update(id: string, input: UpdateTaskData) {
			const [row] = await db
				.update(schema.tasks)
				.set({ ...input, updatedAt: new Date().toISOString() })
				.where(eq(schema.tasks.id, id))
				.returning();

			if (!row) {
				throw new Error(`Failed to update task ${id}`);
			}

			return toTask(row);
		},
		async delete(id: string) {
			await db.delete(schema.tasks).where(eq(schema.tasks.id, id));
		},
		async deleteByIds(ids: string[]) {
			if (ids.length === 0) return;
			await db.delete(schema.tasks).where(inArray(schema.tasks.id, ids));
		},
		async deleteByPageIds(pageIds: string[]) {
			if (pageIds.length === 0) return;
			await db
				.delete(schema.tasks)
				.where(inArray(schema.tasks.pageId, pageIds));
		},
	};
}

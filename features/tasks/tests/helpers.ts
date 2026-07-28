import type { PageRepository } from "@/features/pages/ports";
import type {
	ListTasksOptions,
	NewTask,
	TaskRepository,
	UpdateTaskData,
} from "@/features/tasks/ports";
import type { Task, TaskFilter } from "@/features/tasks/schemas";

export function createTestTaskRepository(options?: {
	pages?: Pick<PageRepository, "findMetaById">;
}): TaskRepository {
	const tasks = new Map<string, Task>();

	function matches(task: Task, filter: TaskFilter): boolean {
		if (filter === "open") return !task.completed;
		if (filter === "completed") return task.completed;
		return true;
	}

	return {
		async listByWorkspace(
			scope,
			filter: TaskFilter,
			listOptions: ListTasksOptions = {},
		) {
			const workspaceId = tenantScopeId(scope);
			const trashedPageIds = new Set<string>();
			for (const task of tasks.values()) {
				if (task.pageId && options?.pages) {
					const page = await options.pages.findMetaById(scope, task.pageId);
					if (page?.deletedAt) {
						trashedPageIds.add(task.pageId);
					}
				}
			}
			const items = Array.from(tasks.values())
				.filter(
					(task) =>
						task.workspaceId === workspaceId &&
						matches(task, filter) &&
						(!listOptions.assigneeId ||
							task.assigneeId === listOptions.assigneeId) &&
						(!listOptions.dueOnOrAfter ||
							(task.dueDate !== null &&
								task.dueDate >= listOptions.dueOnOrAfter)) &&
						(!listOptions.dueOnOrBefore ||
							(task.dueDate !== null &&
								task.dueDate <= listOptions.dueOnOrBefore)) &&
						(task.pageId === null || !trashedPageIds.has(task.pageId)),
				)
				.sort((left, right) => {
					if (left.dueDate === null && right.dueDate !== null) return 1;
					if (left.dueDate !== null && right.dueDate === null) return -1;
					if (left.dueDate !== right.dueDate) {
						return (left.dueDate ?? "").localeCompare(right.dueDate ?? "");
					}
					if (left.dueTime === null && right.dueTime !== null) return 1;
					if (left.dueTime !== null && right.dueTime === null) return -1;
					if (left.dueTime !== right.dueTime) {
						return (left.dueTime ?? "").localeCompare(right.dueTime ?? "");
					}
					return left.createdAt.localeCompare(right.createdAt);
				})
				.slice(0, listOptions.limit);

			return Promise.all(
				items.map(async (task) => ({
					...task,
					pageTitle: task.pageId
						? ((await options?.pages?.findMetaById(scope, task.pageId))
								?.title ?? null)
						: null,
					// Name resolution needs the user table; tests assert on ids.
					assigneeName: null,
				})),
			);
		},
		async listByPage(scope, pageId: string) {
			return Array.from(tasks.values()).filter(
				(task) =>
					task.workspaceId === tenantScopeId(scope) && task.pageId === pageId,
			);
		},
		async findById(scope, id: string) {
			const task = tasks.get(id);
			return task?.workspaceId === tenantScopeId(scope) ? task : null;
		},
		async create(scope, input: NewTask) {
			const now = new Date().toISOString();
			const task: Task = {
				id: crypto.randomUUID(),
				userId: input.userId,
				workspaceId: tenantScopeId(scope),
				pageId: input.pageId,
				sourceBlockId: input.sourceBlockId,
				title: input.title,
				completed: input.completed,
				dueDate: input.dueDate,
				dueTime: input.dueTime,
				reminderOffsetMinutes: input.reminderOffsetMinutes ?? null,
				assigneeId: input.assigneeId,
				completedAt: input.completedAt,
				createdAt: now,
				updatedAt: now,
			};
			tasks.set(task.id, task);
			return task;
		},
		async update(scope, id: string, input: UpdateTaskData) {
			const task = tasks.get(id);
			if (!task || task.workspaceId !== tenantScopeId(scope)) {
				throw new Error(`Task not found: ${id}`);
			}

			const next = { ...task, ...input, updatedAt: new Date().toISOString() };
			tasks.set(id, next);
			return next;
		},
		async delete(scope, id: string) {
			if (tasks.get(id)?.workspaceId === tenantScopeId(scope)) {
				tasks.delete(id);
			}
		},
		async deleteByIds(scope, ids: string[]) {
			for (const id of ids) {
				if (tasks.get(id)?.workspaceId === tenantScopeId(scope)) {
					tasks.delete(id);
				}
			}
		},
		async deleteByPageIds(scope, pageIds: string[]) {
			for (const task of Array.from(tasks.values())) {
				if (
					task.workspaceId === tenantScopeId(scope) &&
					task.pageId !== null &&
					pageIds.includes(task.pageId)
				) {
					tasks.delete(task.id);
				}
			}
		},
	};
}
import { tenantScopeId } from "@beignet/core/ports";

import type { PageRepository } from "@/features/pages/ports";
import type {
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
		async listByWorkspace(workspaceId: string, filter: TaskFilter) {
			const trashedPageIds = new Set<string>();
			for (const task of tasks.values()) {
				if (task.pageId && options?.pages) {
					const page = await options.pages.findMetaById(task.pageId);
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
						(task.pageId === null || !trashedPageIds.has(task.pageId)),
				)
				.sort((left, right) => {
					if (left.dueDate === null && right.dueDate !== null) return 1;
					if (left.dueDate !== null && right.dueDate === null) return -1;
					if (left.dueDate !== right.dueDate) {
						return (left.dueDate ?? "").localeCompare(right.dueDate ?? "");
					}
					return left.createdAt.localeCompare(right.createdAt);
				});

			return Promise.all(
				items.map(async (task) => ({
					...task,
					pageTitle: task.pageId
						? ((await options?.pages?.findMetaById(task.pageId))?.title ?? null)
						: null,
					// Name resolution needs the user table; tests assert on ids.
					assigneeName: null,
				})),
			);
		},
		async listByPage(pageId: string) {
			return Array.from(tasks.values()).filter(
				(task) => task.pageId === pageId,
			);
		},
		async findById(id: string) {
			return tasks.get(id) ?? null;
		},
		async create(input: NewTask) {
			const now = new Date().toISOString();
			const task: Task = {
				id: crypto.randomUUID(),
				userId: input.userId,
				workspaceId: input.workspaceId,
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
			tasks.set(task.id, task);
			return task;
		},
		async update(id: string, input: UpdateTaskData) {
			const task = tasks.get(id);
			if (!task) {
				throw new Error(`Task not found: ${id}`);
			}

			const next = { ...task, ...input, updatedAt: new Date().toISOString() };
			tasks.set(id, next);
			return next;
		},
		async delete(id: string) {
			tasks.delete(id);
		},
		async deleteByIds(ids: string[]) {
			for (const id of ids) {
				tasks.delete(id);
			}
		},
		async deleteByPageIds(pageIds: string[]) {
			for (const task of Array.from(tasks.values())) {
				if (task.pageId !== null && pageIds.includes(task.pageId)) {
					tasks.delete(task.id);
				}
			}
		},
	};
}

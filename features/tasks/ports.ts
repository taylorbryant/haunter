import type { TenantScope } from "@beignet/core/ports";
import type { Task, TaskFilter, TaskWithPage } from "@/features/tasks/schemas";

export type NewTask = {
	userId: string;
	pageId: string | null;
	sourceBlockId: string | null;
	title: string;
	completed: boolean;
	dueDate: string | null;
	dueTime: string | null;
	assigneeId: string | null;
	completedAt: string | null;
};

export type UpdateTaskData = {
	title?: string;
	completed?: boolean;
	dueDate?: string | null;
	dueTime?: string | null;
	assigneeId?: string | null;
	completedAt?: string | null;
};

export type ListTasksOptions = {
	assigneeId?: string;
	dueOnOrAfter?: string;
	dueOnOrBefore?: string;
	limit?: number;
};

export interface TaskRepository {
	/** Workspace tasks, optionally narrowed by assignee, due range, and limit. */
	listByWorkspace(
		scope: TenantScope,
		filter: TaskFilter,
		options?: ListTasksOptions,
	): Promise<TaskWithPage[]>;
	listByPage(scope: TenantScope, pageId: string): Promise<Task[]>;
	findById(scope: TenantScope, id: string): Promise<Task | null>;
	create(scope: TenantScope, input: NewTask): Promise<Task>;
	update(scope: TenantScope, id: string, input: UpdateTaskData): Promise<Task>;
	delete(scope: TenantScope, id: string): Promise<void>;
	deleteByIds(scope: TenantScope, ids: string[]): Promise<void>;
	deleteByPageIds(scope: TenantScope, pageIds: string[]): Promise<void>;
}

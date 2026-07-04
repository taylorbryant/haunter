import type { Task, TaskFilter, TaskWithPage } from "@/features/tasks/schemas";

export type NewTask = {
	userId: string;
	workspaceId: string;
	pageId: string | null;
	sourceBlockId: string | null;
	title: string;
	completed: boolean;
	dueDate: string | null;
	assigneeId: string | null;
	completedAt: string | null;
};

export type UpdateTaskData = {
	title?: string;
	completed?: boolean;
	dueDate?: string | null;
	assigneeId?: string | null;
	completedAt?: string | null;
};

export interface TaskRepository {
	/** Every member sees the whole workspace's tasks; "mine" filters client-side. */
	listByWorkspace(
		workspaceId: string,
		filter: TaskFilter,
	): Promise<TaskWithPage[]>;
	listByPage(pageId: string): Promise<Task[]>;
	findById(id: string): Promise<Task | null>;
	create(input: NewTask): Promise<Task>;
	update(id: string, input: UpdateTaskData): Promise<Task>;
	delete(id: string): Promise<void>;
	deleteByIds(ids: string[]): Promise<void>;
	deleteByPageIds(pageIds: string[]): Promise<void>;
}

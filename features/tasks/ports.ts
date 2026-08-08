import type { TenantScope } from "@beignet/core/ports";
import type { BlockJson } from "@/features/content/schemas";
import type { MemberRepository } from "@/features/members/ports";
import type { NotificationRepository } from "@/features/notifications/ports";
import type { Notification } from "@/features/notifications/schemas";
import type { Task, TaskFilter, TaskWithPage } from "@/features/tasks/schemas";

export type TaskAssignmentActor = {
	userId: string;
	name: string;
};

export type TaskBlockPatch = {
	checked?: boolean;
	due?: string | null;
	dueTime?: string | null;
	reminderOffsetMinutes?: number | null;
	assignee?: string | null;
};

export interface TaskSourceDocumentRepository {
	findById(
		scope: TenantScope,
		id: string,
	): Promise<{
		id: string;
		content: BlockJson[];
		contentUpdatedAt: string;
	} | null>;
	saveContentIf(
		scope: TenantScope,
		id: string,
		contentJson: string,
		searchText: string,
		baseUpdatedAt: string,
	): Promise<{ updatedAt: string; contentUpdatedAt: string } | null>;
}

export interface TaskSourceDocumentPort {
	patchTaskBlock(
		scope: TenantScope,
		input: { pageId: string; blockId: string; patch: TaskBlockPatch },
	): Promise<{ pageId: string; pageContentUpdatedAt: string } | null>;
}

export interface EmbeddedTaskProjectionPort {
	reconcile(
		scope: TenantScope,
		source: { id: string; userId: string; content: BlockJson[] },
		options?: {
			assignmentActor?: TaskAssignmentActor;
			assignmentUser?: {
				id: string;
				name?: string | null;
				email?: string | null;
			};
			defaultAssigneeId?: string | null;
		},
	): Promise<{ changed: boolean; assignmentNotifications: Notification[] }>;
}

export interface TaskAssignmentDeliveryPort {
	schedule(items: Notification[]): void;
}

export type EmbeddedTaskProjectionDependencies = {
	members: MemberRepository;
	notificationInbox: NotificationRepository;
	tasks: TaskRepository;
};

export type NewTask = {
	userId: string;
	pageId: string | null;
	sourceBlockId: string | null;
	title: string;
	completed: boolean;
	dueDate: string | null;
	dueTime: string | null;
	reminderOffsetMinutes?: Task["reminderOffsetMinutes"];
	reminderConfiguredAt?: string | null;
	assigneeId: string | null;
	completedAt: string | null;
};

export type UpdateTaskData = {
	title?: string;
	completed?: boolean;
	dueDate?: string | null;
	dueTime?: string | null;
	reminderOffsetMinutes?: Task["reminderOffsetMinutes"];
	reminderConfiguredAt?: string | null;
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

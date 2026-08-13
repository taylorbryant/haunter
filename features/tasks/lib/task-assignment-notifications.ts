import type { TenantScope } from "@beignet/core/ports";
import type { MemberRepository } from "@/features/members/ports";
import type { NotificationRepository } from "@/features/notifications/ports";
import type { Notification } from "@/features/notifications/schemas";
import type { TaskAssignmentActor } from "@/features/tasks/ports";
import type { Task } from "@/features/tasks/schemas";

export async function resolveTaskAssignmentActor(
	members: MemberRepository,
	scope: TenantScope,
	user: { id: string; name?: string | null; email?: string | null },
): Promise<TaskAssignmentActor> {
	const suppliedName = user.name?.trim() || user.email?.trim();
	if (suppliedName) return { userId: user.id, name: suppliedName };

	const member = (await members.listByWorkspace(scope)).find(
		(candidate) => candidate.userId === user.id,
	);
	return {
		userId: user.id,
		name: member?.name.trim() || member?.email || "A teammate",
	};
}

export async function createTaskAssignmentNotification(
	notificationInbox: NotificationRepository,
	task: Task,
	previousAssigneeId: string | null,
	actor: TaskAssignmentActor | undefined,
): Promise<Notification | null> {
	if (
		!actor ||
		task.completed ||
		task.assigneeId === null ||
		task.assigneeId === previousAssigneeId ||
		task.assigneeId === actor.userId
	) {
		return null;
	}

	const preferences = await notificationInbox.getPreferences(task.assigneeId);
	if (!preferences.taskAssignmentsEnabled) return null;

	return notificationInbox.createTaskAssigned(
		{
			userId: task.assigneeId,
			workspaceId: task.workspaceId,
			entityVersion: `${task.assigneeId}:${task.updatedAt}`,
			taskId: task.id,
			title: task.title,
			assignedByUserId: actor.userId,
			assignedByName: actor.name,
			pageId: task.pageId,
			sourceBlockId: task.sourceBlockId,
		},
		new Date().toISOString(),
	);
}

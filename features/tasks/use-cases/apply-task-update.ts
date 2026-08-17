import "@beignet/core/server-only";
import type { TenantScope } from "@beignet/core/ports";
import { appError } from "@/features/shared/errors";
import { createTaskAssignmentNotification } from "@/features/tasks/lib/task-assignment-notifications";
import { hasTaskSchedulingChanged } from "@/features/tasks/lib/task-scheduling";
import type { TaskAssignmentActor } from "@/features/tasks/ports";
import type { UpdateTaskInput } from "@/features/tasks/schemas";
import type { AppGate, AppTransactionPorts } from "@/ports";

export async function applyTaskUpdate({
	tx,
	scope,
	gate,
	input,
	assignmentActor,
	now,
}: {
	tx: AppTransactionPorts;
	scope: TenantScope;
	gate: AppGate;
	input: UpdateTaskInput;
	assignmentActor?: TaskAssignmentActor;
	now: string;
}) {
	const task = await tx.tasks.findById(scope, input.id);
	if (!task) {
		throw appError("TaskNotFound", { details: { id: input.id } });
	}

	await gate.authorize("tasks.update", task);

	// Page-sourced titles are rich inline content; edit them in the editor.
	if (input.title !== undefined && task.sourceBlockId !== null) {
		throw appError("TaskNotEditable", { details: { id: input.id } });
	}

	// Assignees must be members of the task's workspace.
	if (input.assigneeId !== undefined && input.assigneeId !== null) {
		const role = await tx.members.findRole(task.workspaceId, input.assigneeId);
		if (role === null) {
			throw appError("Forbidden", {
				message: "The assignee is not a member of this workspace.",
				details: { assigneeId: input.assigneeId },
			});
		}
	}

	const dueDate = input.dueDate !== undefined ? input.dueDate : task.dueDate;
	const dueTime =
		input.dueDate === null
			? null
			: input.dueTime !== undefined
				? input.dueTime
				: task.dueTime;
	const reminderOffsetMinutes =
		input.dueDate === null
			? null
			: input.reminderOffsetMinutes !== undefined
				? input.reminderOffsetMinutes
				: task.reminderOffsetMinutes;
	if (dueTime !== null && dueDate === null) {
		throw appError("InvalidTaskDue");
	}
	if (reminderOffsetMinutes !== null && dueDate === null) {
		throw appError("InvalidTaskDue");
	}
	const assigneeId =
		input.assigneeId !== undefined ? input.assigneeId : task.assigneeId;
	const schedulingChanged = hasTaskSchedulingChanged(task, {
		dueDate,
		dueTime,
		reminderOffsetMinutes,
		assigneeId,
	});
	const updated = await tx.tasks.update(scope, task.id, {
		...(input.title !== undefined ? { title: input.title } : {}),
		...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
		...(input.dueDate !== undefined || input.dueTime !== undefined
			? { dueTime }
			: {}),
		...(input.dueDate === null || input.reminderOffsetMinutes !== undefined
			? { reminderOffsetMinutes }
			: {}),
		...(schedulingChanged ? { reminderConfiguredAt: now } : {}),
		...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
		...(input.completed !== undefined ? { completed: input.completed } : {}),
		...(input.completed !== undefined && input.completed !== task.completed
			? { completedAt: input.completed ? now : null }
			: {}),
	});
	if (input.completed === true && !task.completed) {
		await tx.notificationInbox.resolveTaskNotifications(
			task.id,
			"completed",
			now,
		);
	} else if (schedulingChanged) {
		await tx.notificationInbox.dismissScheduledForTasks([task.id], now);
	}

	// Write the change through to the source page so the doc agrees.
	let pagePatch: Awaited<
		ReturnType<typeof tx.taskSourceDocuments.patchTaskBlock>
	> | null = null;
	if (
		task.pageId !== null &&
		task.sourceBlockId !== null &&
		(input.completed !== undefined ||
			input.dueDate !== undefined ||
			input.dueTime !== undefined ||
			input.reminderOffsetMinutes !== undefined ||
			input.assigneeId !== undefined)
	) {
		pagePatch = await tx.taskSourceDocuments.patchTaskBlock(scope, {
			pageId: task.pageId,
			blockId: task.sourceBlockId,
			patch: {
				...(input.completed !== undefined ? { checked: input.completed } : {}),
				...(input.dueDate !== undefined ? { due: input.dueDate } : {}),
				...(input.dueDate !== undefined || input.dueTime !== undefined
					? { dueTime }
					: {}),
				...(input.dueDate === null || input.reminderOffsetMinutes !== undefined
					? { reminderOffsetMinutes }
					: {}),
				...(input.assigneeId !== undefined
					? { assignee: input.assigneeId }
					: {}),
			},
		});
	}

	const assignmentNotification =
		input.assigneeId !== undefined
			? await createTaskAssignmentNotification(
					tx.notificationInbox,
					updated,
					task.assigneeId,
					assignmentActor,
				)
			: null;

	return { updated, assignmentNotification, pagePatch };
}

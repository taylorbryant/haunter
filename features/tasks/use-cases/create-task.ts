import "@beignet/core/server-only";
import { scheduleWorkspaceTaskEvent } from "@/features/collab/server/workspace-events";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import {
	createTaskAssignmentNotification,
	resolveTaskAssignmentActor,
} from "../notifications/assigned";
import { CreateTaskInputSchema, TaskSchema } from "../schemas";

/** Quick-add from the Tasks view: a standalone task not attached to any page. */
export const createTaskUseCase = useCase
	.command("tasks.create")
	.input(CreateTaskInputSchema)
	.output(TaskSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		await ctx.gate.authorize("tasks.create");
		const scope = requireActiveWorkspaceScope(ctx, input.workspaceId);

		const { task, assignmentNotification } = await ctx.ports.uow.transaction(
			async (tx) => {
				// Quick-add means "a task for me" unless the caller says otherwise;
				// explicit null creates it unassigned.
				const assigneeId =
					input.assigneeId === undefined ? user.id : input.assigneeId;

				if (assigneeId !== null && assigneeId !== user.id) {
					const role = await tx.members.findRole(input.workspaceId, assigneeId);
					if (role === null) {
						throw appError("Forbidden", {
							message: "The assignee is not a member of this workspace.",
							details: { assigneeId },
						});
					}
				}

				const task = await tx.tasks.create(scope, {
					userId: user.id,
					pageId: null,
					sourceBlockId: null,
					title: input.title,
					completed: false,
					dueDate: input.dueDate ?? null,
					dueTime: input.dueTime ?? null,
					reminderOffsetMinutes: input.reminderOffsetMinutes ?? null,
					reminderConfiguredAt:
						input.reminderOffsetMinutes !== undefined
							? new Date().toISOString()
							: null,
					assigneeId,
					completedAt: null,
				});
				const actor = await resolveTaskAssignmentActor(tx.members, scope, user);
				const assignmentNotification = await createTaskAssignmentNotification(
					tx.notificationInbox,
					task,
					null,
					actor,
				);
				return { task, assignmentNotification };
			},
		);
		ctx.ports.taskAssignmentDelivery.schedule(
			assignmentNotification ? [assignmentNotification] : [],
		);
		scheduleWorkspaceTaskEvent(ctx, {
			workspaceId: task.workspaceId,
			taskId: task.id,
		});
		return task;
	});

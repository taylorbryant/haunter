import "@beignet/core/server-only";
import { extractPageSearchText } from "@/features/pages/lib/extract-page-text";
import { appError } from "@/features/shared/errors";
import { patchTaskBlock } from "@/features/tasks/lib/patch-task-block";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import {
	createTaskAssignmentNotification,
	resolveTaskAssignmentActor,
	scheduleTaskAssignmentDelivery,
} from "../notifications/assigned";
import { TaskSchema, UpdateTaskInputSchema } from "../schemas";

export const updateTaskUseCase = useCase
	.command("tasks.update")
	.input(UpdateTaskInputSchema)
	.output(TaskSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		const scope = requireActiveWorkspaceScope(ctx);

		const { updated, assignmentNotification } = await ctx.ports.uow.transaction(
			async (tx) => {
				const task = await tx.tasks.findById(scope, input.id);
				if (!task) {
					throw appError("TaskNotFound", { details: { id: input.id } });
				}

				await ctx.gate.authorize("tasks.update", task);

				// Page-sourced titles are rich inline content; edit them in the editor.
				if (input.title !== undefined && task.sourceBlockId !== null) {
					throw appError("TaskNotEditable", { details: { id: input.id } });
				}

				// Assignees must be members of the task's workspace.
				if (input.assigneeId !== undefined && input.assigneeId !== null) {
					const role = await tx.members.findRole(
						task.workspaceId,
						input.assigneeId,
					);
					if (role === null) {
						throw appError("Forbidden", {
							message: "The assignee is not a member of this workspace.",
							details: { assigneeId: input.assigneeId },
						});
					}
				}

				const now = new Date().toISOString();
				const dueDate =
					input.dueDate !== undefined ? input.dueDate : task.dueDate;
				const dueTime =
					input.dueDate === null
						? null
						: input.dueTime !== undefined
							? input.dueTime
							: task.dueTime;
				if (dueTime !== null && dueDate === null) {
					throw appError("InvalidTaskDue");
				}
				const updated = await tx.tasks.update(scope, task.id, {
					...(input.title !== undefined ? { title: input.title } : {}),
					...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
					...(input.dueDate !== undefined || input.dueTime !== undefined
						? { dueTime }
						: {}),
					...(input.assigneeId !== undefined
						? { assigneeId: input.assigneeId }
						: {}),
					...(input.completed !== undefined
						? { completed: input.completed }
						: {}),
					...(input.completed !== undefined &&
					input.completed !== task.completed
						? { completedAt: input.completed ? now : null }
						: {}),
				});
				if (input.completed === true) {
					await tx.inboxItems.deleteByTaskIds(scope, [task.id]);
				}

				// Write the change through to the source page so the doc agrees.
				if (
					task.pageId !== null &&
					task.sourceBlockId !== null &&
					(input.completed !== undefined ||
						input.dueDate !== undefined ||
						input.dueTime !== undefined ||
						input.assigneeId !== undefined)
				) {
					const page = await tx.pages.findById(scope, task.pageId);
					if (page) {
						const { blocks, found } = patchTaskBlock(
							page.content,
							task.sourceBlockId,
							{
								...(input.completed !== undefined
									? { checked: input.completed }
									: {}),
								...(input.dueDate !== undefined ? { due: input.dueDate } : {}),
								...(input.dueDate !== undefined || input.dueTime !== undefined
									? { dueTime }
									: {}),
								...(input.assigneeId !== undefined
									? { assignee: input.assigneeId }
									: {}),
							},
						);
						// A missing block means the row is stale; the next content save
						// will orphan-delete it. Update the row anyway.
						if (found) {
							await tx.pages.saveContent(
								scope,
								page.id,
								JSON.stringify(blocks),
								extractPageSearchText(blocks),
							);
						}
					}
				}

				const actor =
					input.assigneeId !== undefined
						? await resolveTaskAssignmentActor(tx.members, scope, user)
						: undefined;
				const assignmentNotification =
					input.assigneeId !== undefined
						? await createTaskAssignmentNotification(
								tx.notificationInbox,
								updated,
								task.assigneeId,
								actor,
							)
						: null;

				return { updated, assignmentNotification };
			},
		);
		scheduleTaskAssignmentDelivery(
			ctx,
			assignmentNotification ? [assignmentNotification] : [],
		);
		return updated;
	});

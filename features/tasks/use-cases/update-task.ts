import "@beignet/core/server-only";
import {
	pageProjectionFromYDoc,
	patchPageTaskBlock,
} from "@/features/documents/codec";
import { mutateCollaborativeDocument } from "@/features/documents/service";
import { appError } from "@/features/shared/errors";
import { extractTaskBlocks } from "@/features/tasks/lib/extract-task-blocks";
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

		const currentTask = await ctx.ports.tasks.findById(scope, input.id);
		if (!currentTask) {
			throw appError("TaskNotFound", { details: { id: input.id } });
		}
		if (currentTask.pageId !== null && currentTask.sourceBlockId !== null) {
			await ctx.gate.authorize("tasks.update", currentTask);
			if (input.title !== undefined) {
				throw appError("TaskNotEditable", { details: { id: input.id } });
			}
			if (input.assigneeId !== undefined && input.assigneeId !== null) {
				const role = await ctx.ports.members.findRole(
					currentTask.workspaceId,
					input.assigneeId,
				);
				if (role === null) {
					throw appError("Forbidden", {
						message: "The assignee is not a member of this workspace.",
						details: { assigneeId: input.assigneeId },
					});
				}
			}
			const assignmentActor =
				input.assigneeId !== undefined
					? await resolveTaskAssignmentActor(ctx.ports.members, scope, user)
					: undefined;
			let found = false;
			const result = await mutateCollaborativeDocument({
				scope,
				kind: "page",
				entityId: currentTask.pageId,
				ports: ctx.ports,
				assignmentActor,
				apply(doc) {
					const authoritativeTask = extractTaskBlocks(
						pageProjectionFromYDoc(doc).content,
					).find((block) => block.blockId === currentTask.sourceBlockId);
					if (!authoritativeTask) return;
					const dueDate =
						input.dueDate !== undefined ? input.dueDate : authoritativeTask.due;
					const dueTime =
						input.dueDate === null
							? null
							: input.dueTime !== undefined
								? input.dueTime
								: authoritativeTask.dueTime;
					const reminderOffsetMinutes =
						input.dueDate === null
							? null
							: input.reminderOffsetMinutes !== undefined
								? input.reminderOffsetMinutes
								: authoritativeTask.reminderOffsetMinutes;
					if (
						dueDate === null &&
						(dueTime !== null || reminderOffsetMinutes !== null)
					) {
						throw appError("InvalidTaskDue");
					}
					found = patchPageTaskBlock(doc, currentTask.sourceBlockId ?? "", {
						...(input.completed !== undefined
							? { checked: input.completed }
							: {}),
						...(input.dueDate !== undefined ? { due: input.dueDate } : {}),
						...(input.dueDate === null
							? { dueTime: null, reminderOffsetMinutes: null }
							: {
									...(input.dueTime !== undefined
										? { dueTime: input.dueTime }
										: {}),
									...(input.reminderOffsetMinutes !== undefined
										? {
												reminderOffsetMinutes: input.reminderOffsetMinutes,
											}
										: {}),
								}),
						...(input.assigneeId !== undefined
							? { assignee: input.assigneeId }
							: {}),
					});
				},
			});
			if (!found || result.kind !== "page") {
				throw appError("TaskNotFound", { details: { id: input.id } });
			}
			scheduleTaskAssignmentDelivery(ctx, result.assignmentNotifications);
			const updated = await ctx.ports.tasks.findById(scope, input.id);
			if (!updated) {
				throw appError("TaskNotFound", { details: { id: input.id } });
			}
			return updated;
		}

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
				const schedulingChanged =
					dueDate !== task.dueDate ||
					dueTime !== task.dueTime ||
					reminderOffsetMinutes !== task.reminderOffsetMinutes ||
					assigneeId !== task.assigneeId;
				const updated = await tx.tasks.update(scope, task.id, {
					...(input.title !== undefined ? { title: input.title } : {}),
					...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
					...(input.dueDate !== undefined || input.dueTime !== undefined
						? { dueTime }
						: {}),
					...(input.dueDate === null ||
					input.reminderOffsetMinutes !== undefined
						? { reminderOffsetMinutes }
						: {}),
					...(schedulingChanged ? { reminderConfiguredAt: now } : {}),
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
				if (input.completed === true && !task.completed) {
					await tx.notificationInbox.resolveTaskNotifications(
						task.id,
						"completed",
						now,
					);
				} else if (schedulingChanged) {
					await tx.notificationInbox.dismissScheduledForTasks([task.id], now);
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

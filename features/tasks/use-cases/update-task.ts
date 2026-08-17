import "@beignet/core/server-only";
import {
	scheduleWorkspacePageEvent,
	scheduleWorkspaceTaskEvent,
} from "@/features/collab/server/workspace-events";
import { resolveTaskAssignmentActor } from "@/features/tasks/lib/task-assignment-notifications";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { TaskSchema, UpdateTaskInputSchema } from "../schemas";
import { applyTaskUpdate } from "./apply-task-update";

export const updateTaskUseCase = useCase
	.command("tasks.update")
	.input(UpdateTaskInputSchema)
	.output(TaskSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		const scope = requireActiveWorkspaceScope(ctx);

		const { updated, assignmentNotification, pagePatch } =
			await ctx.ports.uow.transaction(async (tx) => {
				const assignmentActor =
					input.assigneeId !== undefined
						? await resolveTaskAssignmentActor(tx.members, scope, user)
						: undefined;
				return applyTaskUpdate({
					tx,
					scope,
					gate: ctx.gate,
					input,
					assignmentActor,
					now: new Date().toISOString(),
				});
			});
		ctx.ports.taskAssignmentDelivery.schedule(
			assignmentNotification ? [assignmentNotification] : [],
		);
		if (pagePatch) {
			scheduleWorkspacePageEvent(ctx, {
				type: "page.contentChanged",
				workspaceId: updated.workspaceId,
				pageId: pagePatch.pageId,
			});
		}
		scheduleWorkspaceTaskEvent(ctx, {
			workspaceId: updated.workspaceId,
			taskId: updated.id,
		});
		return updated;
	});

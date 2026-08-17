import "@beignet/core/server-only";
import {
	scheduleWorkspacePageEvent,
	scheduleWorkspaceTaskEvent,
} from "@/features/collab/server/workspace-events";
import { resolveTaskAssignmentActor } from "@/features/tasks/lib/task-assignment-notifications";
import {
	BulkUpdateTasksInputSchema,
	BulkUpdateTasksOutputSchema,
} from "@/features/tasks/schemas";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { applyTaskUpdate } from "./apply-task-update";

export const bulkUpdateTasksUseCase = useCase
	.command("tasks.bulkUpdate")
	.input(BulkUpdateTasksInputSchema)
	.output(BulkUpdateTasksOutputSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		const scope = requireActiveWorkspaceScope(ctx);
		const now = new Date().toISOString();
		const changes = await ctx.ports.uow.transaction(async (tx) => {
			const assignmentActor =
				input.patch.assigneeId !== undefined
					? await resolveTaskAssignmentActor(tx.members, scope, user)
					: undefined;
			const results = [];
			for (const taskId of input.taskIds) {
				results.push(
					await applyTaskUpdate({
						tx,
						scope,
						gate: ctx.gate,
						input: { id: taskId, ...input.patch },
						assignmentActor,
						now,
					}),
				);
			}
			return results;
		});

		ctx.ports.taskAssignmentDelivery.schedule(
			changes.flatMap(({ assignmentNotification }) =>
				assignmentNotification ? [assignmentNotification] : [],
			),
		);
		const changedPageIds = new Set(
			changes.flatMap(({ pagePatch }) => (pagePatch ? [pagePatch.pageId] : [])),
		);
		for (const pageId of changedPageIds) {
			const task = changes.find(
				({ updated }) => updated.pageId === pageId,
			)?.updated;
			if (!task) continue;
			scheduleWorkspacePageEvent(ctx, {
				type: "page.contentChanged",
				workspaceId: task.workspaceId,
				pageId,
			});
		}
		for (const { updated } of changes) {
			scheduleWorkspaceTaskEvent(ctx, {
				workspaceId: updated.workspaceId,
				taskId: updated.id,
			});
		}

		return changes.map(({ updated }) => updated);
	});

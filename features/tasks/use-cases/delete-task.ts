import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { DeleteTaskOutputSchema, TaskIdInputSchema } from "../schemas";

export const deleteTaskUseCase = useCase
	.command("tasks.delete")
	.input(TaskIdInputSchema)
	.output(DeleteTaskOutputSchema)
	.run(async ({ ctx, input }) => {
		const scope = requireActiveWorkspaceScope(ctx);

		await ctx.ports.uow.transaction(async (tx) => {
			const task = await tx.tasks.findById(scope, input.id);
			if (!task) {
				throw appError("TaskNotFound", { details: { id: input.id } });
			}

			await ctx.gate.authorize("tasks.delete", task);

			// Page-sourced tasks are deleted by removing the block in the editor.
			if (task.sourceBlockId !== null) {
				throw appError("TaskNotEditable", { details: { id: input.id } });
			}

			await tx.notificationInbox.resolveTaskNotifications(
				task.id,
				"dismissed",
				new Date().toISOString(),
			);
			await tx.tasks.delete(scope, task.id);
		});
	});

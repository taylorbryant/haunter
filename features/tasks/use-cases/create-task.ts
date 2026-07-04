import "@beignet/core/server-only";
import { requireActiveWorkspace, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { CreateTaskInputSchema, TaskSchema } from "../schemas";

/** Quick-add from My Tasks: a standalone task not attached to any page. */
export const createTaskUseCase = useCase
	.command("tasks.create")
	.input(CreateTaskInputSchema)
	.output(TaskSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		await ctx.gate.authorize("tasks.create");
		requireActiveWorkspace(ctx, input.workspaceId);

		return ctx.ports.uow.transaction(async (tx) => {
			return tx.tasks.create({
				userId: user.id,
				workspaceId: input.workspaceId,
				pageId: null,
				sourceBlockId: null,
				title: input.title,
				completed: false,
				dueDate: input.dueDate ?? null,
				completedAt: null,
			});
		});
	});

import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireUser } from "@/lib/auth";
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

		return ctx.ports.uow.transaction(async (tx) => {
			const workspace = await tx.workspaces.findById(input.workspaceId);
			if (!workspace) {
				throw appError("WorkspaceNotFound", {
					details: { id: input.workspaceId },
				});
			}

			await ctx.gate.authorize("workspaces.update", workspace);

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

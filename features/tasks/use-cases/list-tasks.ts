import "@beignet/core/server-only";
import { requireActiveWorkspace, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { ListTasksInputSchema, ListTasksOutputSchema } from "../schemas";

export const listTasksUseCase = useCase
	.query("tasks.list")
	.input(ListTasksInputSchema)
	.output(ListTasksOutputSchema)
	.run(async ({ ctx, input }) => {
		requireUser(ctx);
		requireActiveWorkspace(ctx, input.workspaceId);

		// Workspace-wide by design: every member sees the same task list, and
		// "assigned to me" is a view filter, not a data boundary.
		const items = await ctx.ports.tasks.listByWorkspace(
			input.workspaceId,
			input.filter,
		);
		return { items };
	});

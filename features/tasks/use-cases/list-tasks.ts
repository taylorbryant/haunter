import "@beignet/core/server-only";
import { requireActiveWorkspace, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { ListTasksInputSchema, ListTasksOutputSchema } from "../schemas";

export const listTasksUseCase = useCase
	.query("tasks.list")
	.input(ListTasksInputSchema)
	.output(ListTasksOutputSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		requireActiveWorkspace(ctx, input.workspaceId);

		const items = await ctx.ports.tasks.listByWorkspace(
			input.workspaceId,
			input.filter,
			{
				assigneeId: input.scope === "mine" ? user.id : undefined,
				limit: input.limit + 1,
			},
		);
		return {
			items: items.slice(0, input.limit),
			hasMore: items.length > input.limit,
		};
	});

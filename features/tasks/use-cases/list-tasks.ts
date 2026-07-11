import "@beignet/core/server-only";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { ListTasksInputSchema, ListTasksOutputSchema } from "../schemas";

export const listTasksUseCase = useCase
	.query("tasks.list")
	.input(ListTasksInputSchema)
	.output(ListTasksOutputSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		const scope = requireActiveWorkspaceScope(ctx, input.workspaceId);

		const items = await ctx.ports.tasks.listByWorkspace(scope, input.filter, {
			assigneeId: input.scope === "mine" ? user.id : undefined,
			dueOnOrAfter: input.dueOnOrAfter,
			dueOnOrBefore: input.dueOnOrBefore,
			limit: input.limit + 1,
		});
		return {
			items: items.slice(0, input.limit),
			hasMore: items.length > input.limit,
		};
	});

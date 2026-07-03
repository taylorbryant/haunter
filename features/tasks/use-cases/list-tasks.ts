import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { ListTasksInputSchema, ListTasksOutputSchema } from "../schemas";

export const listTasksUseCase = useCase
	.query("tasks.list")
	.input(ListTasksInputSchema)
	.output(ListTasksOutputSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);

		const workspace = await ctx.ports.workspaces.findById(input.workspaceId);
		if (!workspace) {
			throw appError("WorkspaceNotFound", {
				details: { id: input.workspaceId },
			});
		}

		await ctx.gate.authorize("workspaces.read", workspace);

		const items = await ctx.ports.tasks.listByWorkspace(
			user.id,
			input.workspaceId,
			input.filter,
		);
		return { items };
	});

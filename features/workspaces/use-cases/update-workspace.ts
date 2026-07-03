import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { UpdateWorkspaceInputSchema, WorkspaceSchema } from "../schemas";

export const updateWorkspaceUseCase = useCase
	.command("workspaces.update")
	.input(UpdateWorkspaceInputSchema)
	.output(WorkspaceSchema)
	.run(async ({ ctx, input }) => {
		requireUser(ctx);

		return ctx.ports.uow.transaction(async (tx) => {
			const workspace = await tx.workspaces.findById(input.id);
			if (!workspace) {
				throw appError("WorkspaceNotFound", { details: { id: input.id } });
			}

			await ctx.gate.authorize("workspaces.update", workspace);

			return tx.workspaces.update(input.id, {
				...(input.name !== undefined ? { name: input.name } : {}),
				...(input.icon !== undefined ? { icon: input.icon } : {}),
			});
		});
	});

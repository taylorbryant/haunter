import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import {
	DeleteWorkspaceOutputSchema,
	WorkspaceIdInputSchema,
} from "../schemas";

export const deleteWorkspaceUseCase = useCase
	.command("workspaces.delete")
	.input(WorkspaceIdInputSchema)
	.output(DeleteWorkspaceOutputSchema)
	.run(async ({ ctx, input }) => {
		requireUser(ctx);

		await ctx.ports.uow.transaction(async (tx) => {
			const workspace = await tx.workspaces.findById(input.id);
			if (!workspace) {
				throw appError("WorkspaceNotFound", { details: { id: input.id } });
			}

			await ctx.gate.authorize("workspaces.delete", workspace);

			await tx.pages.deleteByWorkspace(input.id);
			await tx.workspaces.delete(input.id);
		});
	});

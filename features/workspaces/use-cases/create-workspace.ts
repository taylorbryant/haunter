import "@beignet/core/server-only";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { CreateWorkspaceInputSchema, WorkspaceSchema } from "../schemas";

export const createWorkspaceUseCase = useCase
	.command("workspaces.create")
	.input(CreateWorkspaceInputSchema)
	.output(WorkspaceSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		await ctx.gate.authorize("workspaces.create");

		return ctx.ports.uow.transaction(async (tx) => {
			const existing = await tx.workspaces.listByUser(user.id);
			const position =
				existing.reduce((max, w) => Math.max(max, w.position), 0) + 1;

			return tx.workspaces.create({
				userId: user.id,
				name: input.name,
				icon: input.icon ?? null,
				position,
			});
		});
	});

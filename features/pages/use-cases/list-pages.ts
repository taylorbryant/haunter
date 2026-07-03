import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { ListPagesInputSchema, ListPagesOutputSchema } from "../schemas";

export const listPagesUseCase = useCase
	.query("pages.list")
	.input(ListPagesInputSchema)
	.output(ListPagesOutputSchema)
	.run(async ({ ctx, input }) => {
		requireUser(ctx);

		const workspace = await ctx.ports.workspaces.findById(input.workspaceId);
		if (!workspace) {
			throw appError("WorkspaceNotFound", {
				details: { id: input.workspaceId },
			});
		}

		await ctx.gate.authorize("workspaces.read", workspace);

		const items = await ctx.ports.pages.listMetaByWorkspace(input.workspaceId);
		return { items };
	});

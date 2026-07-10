import "@beignet/core/server-only";
import { requireActiveWorkspaceScope } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { ListPagesInputSchema, ListPagesOutputSchema } from "../schemas";

export const listPagesUseCase = useCase
	.query("pages.list")
	.input(ListPagesInputSchema)
	.output(ListPagesOutputSchema)
	.run(async ({ ctx, input }) => {
		const scope = requireActiveWorkspaceScope(ctx, input.workspaceId);

		const items = await ctx.ports.pages.listMetaByWorkspace(scope);
		return { items };
	});

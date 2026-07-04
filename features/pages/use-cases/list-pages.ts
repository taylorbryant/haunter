import "@beignet/core/server-only";
import { requireActiveWorkspace } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { ListPagesInputSchema, ListPagesOutputSchema } from "../schemas";

export const listPagesUseCase = useCase
	.query("pages.list")
	.input(ListPagesInputSchema)
	.output(ListPagesOutputSchema)
	.run(async ({ ctx, input }) => {
		requireActiveWorkspace(ctx, input.workspaceId);

		const items = await ctx.ports.pages.listMetaByWorkspace(input.workspaceId);
		return { items };
	});

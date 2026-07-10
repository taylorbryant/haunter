import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { ListPageVersionsOutputSchema, PageIdInputSchema } from "../schemas";

export const listPageVersionsUseCase = useCase
	.query("pages.listVersions")
	.input(PageIdInputSchema)
	.output(ListPageVersionsOutputSchema)
	.run(async ({ ctx, input }) => {
		const scope = requireActiveWorkspaceScope(ctx);

		const page = await ctx.ports.pages.findMetaById(scope, input.id);
		if (!page || page.deletedAt !== null) {
			throw appError("PageNotFound", { details: { id: input.id } });
		}

		await ctx.gate.authorize("pages.read", page);

		const items = await ctx.ports.pageVersions.listMetaByPage(scope, input.id);
		return { items };
	});

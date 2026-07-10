import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { ListBacklinksOutputSchema, PageIdInputSchema } from "../schemas";

/** List live pages whose documents link to this page. */
export const listBacklinksUseCase = useCase
	.query("pages.listBacklinks")
	.input(PageIdInputSchema)
	.output(ListBacklinksOutputSchema)
	.run(async ({ ctx, input }) => {
		const scope = requireActiveWorkspaceScope(ctx);

		const page = await ctx.ports.pages.findMetaById(scope, input.id);
		if (!page || page.deletedAt !== null) {
			throw appError("PageNotFound", { details: { id: input.id } });
		}

		await ctx.gate.authorize("pages.read", page);

		const items = await ctx.ports.pageLinks.listBacklinkSources(
			scope,
			input.id,
		);
		return { items };
	});

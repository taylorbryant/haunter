import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { ListBacklinksOutputSchema, PageIdInputSchema } from "../schemas";

/** List live pages whose documents link to this page. */
export const listBacklinksUseCase = useCase
	.query("pages.listBacklinks")
	.input(PageIdInputSchema)
	.output(ListBacklinksOutputSchema)
	.run(async ({ ctx, input }) => {
		requireUser(ctx);

		const page = await ctx.ports.pages.findMetaById(input.id);
		if (!page || page.deletedAt !== null) {
			throw appError("PageNotFound", { details: { id: input.id } });
		}

		await ctx.gate.authorize("pages.read", page);

		const items = await ctx.ports.pageLinks.listBacklinkSources(input.id);
		return { items };
	});

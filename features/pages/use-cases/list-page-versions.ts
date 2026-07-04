import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { ListPageVersionsOutputSchema, PageIdInputSchema } from "../schemas";

export const listPageVersionsUseCase = useCase
	.query("pages.listVersions")
	.input(PageIdInputSchema)
	.output(ListPageVersionsOutputSchema)
	.run(async ({ ctx, input }) => {
		requireUser(ctx);

		const page = await ctx.ports.pages.findMetaById(input.id);
		if (!page || page.deletedAt !== null) {
			throw appError("PageNotFound", { details: { id: input.id } });
		}

		await ctx.gate.authorize("pages.read", page);

		const items = await ctx.ports.pageVersions.listMetaByPage(input.id);
		return { items };
	});

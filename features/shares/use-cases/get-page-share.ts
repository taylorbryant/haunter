import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { GetPageShareOutputSchema, PageIdInputSchema } from "../schemas";

export const getPageShareUseCase = useCase
	.query("shares.get")
	.input(PageIdInputSchema)
	.output(GetPageShareOutputSchema)
	.run(async ({ ctx, input }) => {
		requireUser(ctx);

		const page = await ctx.ports.pages.findMetaById(input.pageId);
		if (!page || page.deletedAt !== null) {
			throw appError("PageNotFound", { details: { id: input.pageId } });
		}

		await ctx.gate.authorize("pages.read", page);

		const share = await ctx.ports.shares.findByPage(input.pageId);
		return { share };
	});

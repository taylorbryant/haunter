import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { PageIdInputSchema, PageSchema } from "../schemas";

export const getPageUseCase = useCase
	.query("pages.get")
	.input(PageIdInputSchema)
	.output(PageSchema)
	.run(async ({ ctx, input }) => {
		requireUser(ctx);

		const page = await ctx.ports.pages.findById(input.id);
		if (!page || page.deletedAt !== null) {
			throw appError("PageNotFound", { details: { id: input.id } });
		}

		await ctx.gate.authorize("pages.read", page);

		return page;
	});

import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { PageIdInputSchema, PageMetaSchema } from "../schemas";

export const getPageMetadataUseCase = useCase
	.query("pages.getPageMetadata")
	.input(PageIdInputSchema)
	.output(PageMetaSchema)
	.run(async ({ ctx, input }) => {
		const scope = requireActiveWorkspaceScope(ctx);
		const page = await ctx.ports.pages.findMetaById(scope, input.id);
		if (!page || page.deletedAt !== null)
			throw appError("PageNotFound", { details: { id: input.id } });
		await ctx.gate.authorize("pages.read", page);
		return page;
	});

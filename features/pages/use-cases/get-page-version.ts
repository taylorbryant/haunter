import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { PageVersionIdInputSchema, PageVersionSchema } from "../schemas";

export const getPageVersionUseCase = useCase
	.query("pages.getVersion")
	.input(PageVersionIdInputSchema)
	.output(PageVersionSchema)
	.run(async ({ ctx, input }) => {
		requireUser(ctx);

		const page = await ctx.ports.pages.findMetaById(input.id);
		if (!page || page.deletedAt !== null) {
			throw appError("PageNotFound", { details: { id: input.id } });
		}

		await ctx.gate.authorize("pages.read", page);

		const version = await ctx.ports.pageVersions.findById(input.versionId);
		if (!version || version.pageId !== page.id) {
			throw appError("PageNotFound", { details: { id: input.versionId } });
		}

		return version;
	});

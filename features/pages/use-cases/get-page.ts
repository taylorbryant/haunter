import "@beignet/core/server-only";
import { isDocumentStoreUnavailable } from "@/features/documents/errors";
import { readCollaborativePageProjection } from "@/features/documents/service";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { PageIdInputSchema, PageSchema } from "../schemas";

export const getPageUseCase = useCase
	.query("pages.get")
	.input(PageIdInputSchema)
	.output(PageSchema)
	.run(async ({ ctx, input }) => {
		const scope = requireActiveWorkspaceScope(ctx);

		const page = await ctx.ports.pages.findById(scope, input.id);
		if (!page || page.deletedAt !== null) {
			throw appError("PageNotFound", { details: { id: input.id } });
		}

		await ctx.gate.authorize("pages.read", page);
		try {
			const projection = await readCollaborativePageProjection({
				scope,
				entityId: page.id,
				ports: ctx.ports,
			});
			return {
				...page,
				title: projection.title,
				content: projection.content,
			};
		} catch (error) {
			if (!isDocumentStoreUnavailable(error)) throw error;
			ctx.ports.logger.warn(
				"Serving a stale read-only page projection while the document store is unavailable",
				{ error, pageId: page.id },
			);
		}

		return page;
	});

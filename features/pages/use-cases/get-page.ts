import "@beignet/core/server-only";
import { isDocumentStoreUnavailable } from "@/features/documents/errors";
import { documentCacheEpoch } from "@/features/documents/model";
import { readCollaborativePageProjection } from "@/features/documents/service";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { PageDetailSchema, PageIdInputSchema } from "../schemas";

export const getPageUseCase = useCase
	.query("pages.get")
	.input(PageIdInputSchema)
	.output(PageDetailSchema)
	.run(async ({ ctx, input }) => {
		const scope = requireActiveWorkspaceScope(ctx);

		const page = await ctx.ports.pages.findById(scope, input.id);
		if (!page || page.deletedAt !== null) {
			throw appError("PageNotFound", { details: { id: input.id } });
		}

		await ctx.gate.authorize("pages.read", page);
		let result = page;
		try {
			const projection = await readCollaborativePageProjection({
				scope,
				entityId: page.id,
				ports: ctx.ports,
			});
			result = {
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

		const registered = await ctx.ports.documents.findByEntity(
			scope,
			"page",
			page.id,
		);
		return {
			...result,
			documentCacheEpoch: registered ? documentCacheEpoch(registered) : null,
		};
	});

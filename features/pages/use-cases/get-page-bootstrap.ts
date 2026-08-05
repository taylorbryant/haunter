import "@beignet/core/server-only";
import { documentCacheEpoch } from "@/features/documents/model";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { PageBootstrapSchema, PageIdInputSchema } from "../schemas";

/**
 * Load only the durable SQLite projection and document identity required by
 * the browser shell. Editable content still comes from the authoritative Yjs
 * room; this avoids putting a Liveblocks REST read on the route critical path.
 */
export const getPageBootstrapUseCase = useCase
	.query("pages.getBootstrap")
	.input(PageIdInputSchema)
	.output(PageBootstrapSchema)
	.run(async ({ ctx, input }) => {
		const startedAt = performance.now();
		const scope = requireActiveWorkspaceScope(ctx);
		const [page, registered] = await Promise.all([
			ctx.ports.pages.findById(scope, input.id),
			ctx.ports.documents.findByEntity(scope, "page", input.id),
		]);
		if (!page || page.deletedAt !== null) {
			throw appError("PageNotFound", { details: { id: input.id } });
		}

		await ctx.gate.authorize("pages.read", page);
		ctx.ports.logger.debug("Page bootstrap loaded", {
			pageId: page.id,
			durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
		});

		return {
			...page,
			documentCacheEpoch: registered ? documentCacheEpoch(registered) : null,
		};
	});

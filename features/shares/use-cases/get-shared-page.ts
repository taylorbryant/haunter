import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { useCase } from "@/lib/use-case";
import { SharedPageSchema, SharedTokenInputSchema } from "../schemas";

/**
 * Public read of a shared page. The token is the whole authorization — no
 * session, tenant, or membership is consulted, so this must never return
 * anything beyond the shared page's own content. A revoked link (deleted
 * row) and a trashed page both read as the same uniform 404.
 */
export const getSharedPageUseCase = useCase
	.query("shares.getShared")
	.input(SharedTokenInputSchema)
	.output(SharedPageSchema)
	.run(async ({ ctx, input }) => {
		const share = await ctx.ports.shares.findByToken(input.token);
		if (!share) {
			throw appError("ShareNotFound");
		}

		const page = await ctx.ports.pages.findById(share.pageId);
		if (!page || page.deletedAt !== null) {
			throw appError("ShareNotFound");
		}

		return {
			title: page.title,
			icon: page.icon,
			content: page.content,
			updatedAt: page.updatedAt,
		};
	});

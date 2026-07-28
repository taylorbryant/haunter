import "@beignet/core/server-only";
import { createTenant, createTenantScope } from "@beignet/core/ports";
import { appError } from "@/features/shared/errors";
import { useCase } from "@/lib/use-case";
import { rewriteFileUrls } from "../lib/rewrite-file-urls";
import { stripPrivateTaskProps } from "../lib/strip-private-task-props";
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

		// The persisted capability, not request input, establishes this scope.
		const scope = createTenantScope(createTenant(share.workspaceId));
		const page = await ctx.ports.pages.findById(scope, share.pageId);
		if (!page || page.deletedAt !== null) {
			throw appError("ShareNotFound");
		}

		return {
			title: page.title,
			icon: page.icon,
			// Point embedded files at the share-scoped read route so anonymous
			// visitors can load them.
			content: rewriteFileUrls(
				stripPrivateTaskProps(page.content),
				input.token,
			),
			updatedAt: page.updatedAt,
		};
	});

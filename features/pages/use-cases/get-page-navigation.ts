import "@beignet/core/server-only";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { ListPagesInputSchema, PageNavigationOutputSchema } from "../schemas";

const RECENT_PAGE_LIMIT = 10;

export const getPageNavigationUseCase = useCase
	.query("pages.getNavigation")
	.input(ListPagesInputSchema)
	.output(PageNavigationOutputSchema)
	.run(async ({ ctx, input }) => {
		const scope = requireActiveWorkspaceScope(ctx, input.workspaceId);
		const user = requireUser(ctx);
		return ctx.ports.pageNavigation.listForUser(
			scope,
			user.id,
			RECENT_PAGE_LIMIT,
		);
	});

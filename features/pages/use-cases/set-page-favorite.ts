import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import {
	PageIdInputSchema,
	SetPageFavoriteBodySchema,
	SetPageFavoriteOutputSchema,
} from "../schemas";

const InputSchema = PageIdInputSchema.merge(SetPageFavoriteBodySchema);

export const setPageFavoriteUseCase = useCase
	.command("pages.setFavorite")
	.input(InputSchema)
	.output(SetPageFavoriteOutputSchema)
	.run(async ({ ctx, input }) => {
		const scope = requireActiveWorkspaceScope(ctx);
		const user = requireUser(ctx);
		const page = await ctx.ports.pages.findMetaById(scope, input.id);
		if (!page || page.deletedAt !== null) {
			throw appError("PageNotFound", { details: { id: input.id } });
		}
		await ctx.gate.authorize("pages.read", page);
		const favoritedAt = await ctx.ports.pageNavigation.setFavorite(
			scope,
			user.id,
			page.id,
			input.favorite,
		);
		return { pageId: page.id, favoritedAt };
	});

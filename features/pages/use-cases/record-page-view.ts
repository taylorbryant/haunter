import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { PageIdInputSchema, RecordPageViewOutputSchema } from "../schemas";

export const recordPageViewUseCase = useCase
	.command("pages.recordView")
	.input(PageIdInputSchema)
	.output(RecordPageViewOutputSchema)
	.run(async ({ ctx, input }) => {
		const scope = requireActiveWorkspaceScope(ctx);
		const user = requireUser(ctx);
		const page = await ctx.ports.pages.findMetaById(scope, input.id);
		if (!page || page.deletedAt !== null) {
			throw appError("PageNotFound", { details: { id: input.id } });
		}
		await ctx.gate.authorize("pages.read", page);
		const lastViewedAt = await ctx.ports.pageNavigation.recordView(
			scope,
			user.id,
			page.id,
		);
		return { pageId: page.id, lastViewedAt };
	});

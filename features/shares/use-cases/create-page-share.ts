import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { PageIdInputSchema, PageShareSchema } from "../schemas";

/** A share token is a bearer capability; make it unguessable. */
function generateToken(): string {
	return crypto.randomUUID().replaceAll("-", "");
}

/**
 * Publish a page to the web. Idempotent — sharing an already-shared page
 * returns the existing link so the URL stays stable.
 */
export const createPageShareUseCase = useCase
	.command("shares.create")
	.input(PageIdInputSchema)
	.output(PageShareSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);

		return ctx.ports.uow.transaction(async (tx) => {
			const page = await tx.pages.findMetaById(input.pageId);
			if (!page || page.deletedAt !== null) {
				throw appError("PageNotFound", { details: { id: input.pageId } });
			}

			// Publishing a page is an editor-level action on that page.
			await ctx.gate.authorize("pages.update", page);

			const existing = await tx.shares.findByPage(input.pageId);
			if (existing) return existing;

			return tx.shares.create({
				pageId: page.id,
				workspaceId: page.workspaceId,
				token: generateToken(),
				createdBy: user.id,
			});
		});
	});

import "@beignet/core/server-only";
import type { PageRepository } from "@/features/pages/ports";
import { appError } from "@/features/shared/errors";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { DeletePageOutputSchema, PageIdInputSchema } from "../schemas";

/** Collect the page and all descendants, deepest last. */
export async function collectSubtreeIds(
	pages: Pick<PageRepository, "listIdsByParent">,
	rootId: string,
): Promise<string[]> {
	const ids: string[] = [rootId];
	for (let cursor = 0; cursor < ids.length; cursor++) {
		const id = ids[cursor];
		if (id === undefined) break;
		ids.push(...(await pages.listIdsByParent(id)));
	}
	return ids;
}

/** Soft delete: move the page and its whole subtree to the trash. */
export const deletePageUseCase = useCase
	.command("pages.delete")
	.input(PageIdInputSchema)
	.output(DeletePageOutputSchema)
	.run(async ({ ctx, input }) => {
		requireUser(ctx);

		await ctx.ports.uow.transaction(async (tx) => {
			const page = await tx.pages.findMetaById(input.id);
			if (!page || page.deletedAt !== null) {
				throw appError("PageNotFound", { details: { id: input.id } });
			}

			await ctx.gate.authorize("pages.delete", page);

			const subtree = await collectSubtreeIds(tx.pages, page.id);
			await tx.pages.setDeletedByIds(subtree, new Date().toISOString());
		});
	});

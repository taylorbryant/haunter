import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { reconcilePageTasks } from "@/features/tasks/lib/reconcile-page-tasks";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { extractPageLinks } from "../lib/extract-page-links";
import {
	SavePageContentInputSchema,
	SavePageContentOutputSchema,
} from "../schemas";

export const savePageContentUseCase = useCase
	.command("pages.saveContent")
	.input(SavePageContentInputSchema)
	.output(SavePageContentOutputSchema)
	.run(async ({ ctx, input }) => {
		requireUser(ctx);

		return ctx.ports.uow.transaction(async (tx) => {
			const page = await tx.pages.findMetaById(input.id);
			if (!page || page.deletedAt !== null) {
				throw appError("PageNotFound", { details: { id: input.id } });
			}

			await ctx.gate.authorize("pages.update", page);

			const result = await tx.pages.saveContent(
				input.id,
				JSON.stringify(input.content),
			);

			// The saved document is the source of truth for its task blocks.
			await reconcilePageTasks(tx.tasks, page, input.content);

			// Likewise for its outgoing page links: keep only targets that
			// still exist and belong to the same owner (purged or foreign ids
			// would break the link table's foreign keys).
			const targets: string[] = [];
			for (const targetId of extractPageLinks(input.content)) {
				if (targetId === page.id) continue;
				const target = await tx.pages.findMetaById(targetId);
				if (target && target.userId === page.userId) {
					targets.push(targetId);
				}
			}
			await tx.pageLinks.replaceForSource(page.id, page.userId, targets);

			return result;
		});
	});

import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { reconcilePageDerivations } from "../lib/apply-page-content";
import {
	PageVersionIdInputSchema,
	SavePageContentOutputSchema,
} from "../schemas";
import { VERSION_RETENTION } from "./save-page-content";

/**
 * Overwrite the page document with a stored version. The current state is
 * always snapshotted first (cause "restore"), so a restore can itself be
 * undone from history. An explicit user action, so it intentionally
 * last-write-wins over concurrent autosaves.
 */
export const restorePageVersionUseCase = useCase
	.command("pages.restoreVersion")
	.input(PageVersionIdInputSchema)
	.output(SavePageContentOutputSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);

		return ctx.ports.uow.transaction(async (tx) => {
			const page = await tx.pages.findMetaById(input.id);
			if (!page || page.deletedAt !== null) {
				throw appError("PageNotFound", { details: { id: input.id } });
			}

			await ctx.gate.authorize("pages.update", page);

			const version = await tx.pageVersions.findById(input.versionId);
			if (!version || version.pageId !== page.id) {
				throw appError("PageNotFound", { details: { id: input.versionId } });
			}

			// Preserve what's being replaced.
			const current = await tx.pages.findById(page.id);
			if (current) {
				await tx.pageVersions.create({
					pageId: page.id,
					workspaceId: page.workspaceId,
					title: current.title,
					icon: current.icon,
					contentJson: JSON.stringify(current.content),
					cause: "restore",
					createdBy: user.id,
				});
				await tx.pageVersions.prune(page.id, VERSION_RETENTION);
			}

			const result = await tx.pages.saveContent(
				page.id,
				JSON.stringify(version.content),
			);

			// A restored document is the source of truth again: reconcile its
			// task rows and page links exactly like a normal save.
			await reconcilePageDerivations(tx, page, version.content);

			return result;
		});
	});

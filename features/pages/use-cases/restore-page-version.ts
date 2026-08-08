import "@beignet/core/server-only";
import { scheduleWorkspacePageEvent } from "@/features/collab/server/workspace-events";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { reconcilePageDerivations } from "../lib/apply-page-content";
import { extractPageSearchText } from "../lib/extract-page-text";
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
		const scope = requireActiveWorkspaceScope(ctx);

		const {
			result: output,
			assignmentNotifications,
			workspaceId,
		} = await ctx.ports.uow.transaction(async (tx) => {
			const page = await tx.pages.findMetaById(scope, input.id);
			if (!page || page.deletedAt !== null) {
				throw appError("PageNotFound", { details: { id: input.id } });
			}

			await ctx.gate.authorize("pages.update", page);

			const version = await tx.pageVersions.findById(scope, input.versionId);
			if (!version || version.pageId !== page.id) {
				throw appError("PageNotFound", { details: { id: input.versionId } });
			}

			// Preserve what's being replaced.
			const current = await tx.pages.findById(scope, page.id);
			if (current) {
				await tx.pageVersions.create(scope, {
					pageId: page.id,
					title: current.title,
					icon: current.icon,
					contentJson: JSON.stringify(current.content),
					cause: "restore",
					createdBy: user.id,
				});
				await tx.pageVersions.prune(scope, page.id, VERSION_RETENTION);
			}

			const result = await tx.pages.saveContent(
				scope,
				page.id,
				JSON.stringify(version.content),
				extractPageSearchText(version.content),
			);

			// A restored document is the source of truth again: reconcile its
			// task rows and page links exactly like a normal save.
			const derivations = await reconcilePageDerivations(
				tx,
				scope,
				page,
				version.content,
				{
					assignmentUser: user,
					defaultTaskAssigneeId: user.id,
				},
			);

			const { assignmentNotifications, ...publicDerivations } = derivations;
			return {
				result: { ...result, ...publicDerivations },
				assignmentNotifications,
				workspaceId: page.workspaceId,
			};
		});
		ctx.ports.taskAssignmentDelivery.schedule(assignmentNotifications);
		scheduleWorkspacePageEvent(ctx, {
			type: "page.contentChanged",
			workspaceId,
			pageId: input.id,
		});
		return output;
	});

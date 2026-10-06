import "@beignet/core/server-only";
import { scheduleWorkspacePageEvent } from "@/features/collab/server/workspace-events";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { reconcilePageDerivations } from "../lib/apply-page-content";
import {
	PageVersionIdInputSchema,
	SavePageContentOutputSchema,
} from "../schemas";
import { VERSION_RETENTION } from "./save-page-content";
import { PageRevisionSchema } from "../block-editing";
import { assertDocumentRevision } from "@/features/documents/revision";

/**
 * Overwrite the page document with a stored version. The current state is
 * always snapshotted first (cause "restore"), so a restore can itself be
 * undone from history. UI restores intentionally use last-write-wins;
 * delegated restores supply a revision checked in this transaction. Restores start a
 * new generation; old clients retain recovery copies instead of merging back.
 */
export const restorePageVersionUseCase = useCase
	.command("pages.restoreVersion")
	.input(
		PageVersionIdInputSchema.extend({
			expectedRevision: PageRevisionSchema.optional(),
		}),
	)
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
			if (input.expectedRevision !== undefined) {
				const document = await tx.documents.find(scope, page.id);
				if (!document) throw appError("InvalidPageContent");
				assertDocumentRevision(document, input.expectedRevision);
			}

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

			const { content, ...result } = await tx.pages.restoreContent(
				scope,
				page.id,
				version.content,
			);

			// A restored document is the source of truth again: reconcile its
			// task rows and page links exactly like a normal save.
			const derivations = await reconcilePageDerivations(
				tx,
				scope,
				page,
				content,
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

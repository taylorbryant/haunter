import "@beignet/core/server-only";
import type { AppContext } from "@/app-context";
import { scheduleWorkspacePageEvent } from "@/features/collab/server/workspace-events";
import type { DocumentWriteResult } from "@/features/documents/ports";
import {
	assertDocumentRevision,
	documentRevision,
} from "@/features/documents/revision";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import type { AppTransactionPorts } from "@/ports";
import { reconcilePageDerivations } from "./apply-page-content";
import { VERSION_RETENTION } from "./checkpoint-page";

/** One authoritative transaction for edits, a recovery snapshot, and all projections. */
export async function writePageDocument(
	ctx: AppContext,
	input: { id: string; expectedRevision: string },
	write: (
		tx: AppTransactionPorts,
		scope: ReturnType<typeof requireActiveWorkspaceScope>,
	) => Promise<
		DocumentWriteResult & { generation: number; insertedBlockIds: string[] }
	>,
) {
	const user = requireUser(ctx);
	const scope = requireActiveWorkspaceScope(ctx);
	const { output, assignmentNotifications, workspaceId } =
		await ctx.ports.uow.transaction(async (tx) => {
			const page = await tx.pages.findById(scope, input.id);
			if (!page || page.deletedAt !== null) throw appError("PageNotFound");
			await ctx.gate.authorize("pages.update", page);
			const document = await tx.documents.find(scope, page.id);
			if (!document)
				throw appError("InvalidPageContent", {
					message: "The page body has not been migrated.",
				});
			assertDocumentRevision(document, input.expectedRevision);
			const history = await tx.pageVersions.create(scope, {
				pageId: page.id,
				title: page.title,
				icon: page.icon,
				contentJson: JSON.stringify(page.content),
				cause: "checkpoint",
				createdBy: user.id,
			});
			await tx.pageVersions.prune(scope, page.id, VERSION_RETENTION);
			const saved = await write(tx, scope);
			const { assignmentNotifications, ...derived } =
				await reconcilePageDerivations(tx, scope, page, saved.content, {
					assignmentUser: user,
					defaultTaskAssigneeId: user.id,
				});
			return {
				output: {
					pageId: page.id,
					title: page.title,
					updatedAt: saved.updatedAt,
					revision: documentRevision({
						pageId: page.id,
						generation: saved.generation,
						revision: saved.revision,
					}),
					insertedBlockIds: saved.insertedBlockIds,
					historyVersionId: history.id,
					...derived,
				},
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
}

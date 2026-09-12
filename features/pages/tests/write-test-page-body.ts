// Fixture driver for projection/history tests. Browser body writes are covered by documents/tests.
import "@beignet/core/server-only";
import { scheduleWorkspacePageEvent } from "@/features/collab/server/workspace-events";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { reconcilePageDerivations } from "../lib/apply-page-content";
import {
	SavePageContentInputSchema,
	SavePageContentOutputSchema,
} from "../schemas";

import { checkpointPageBeforeWrite } from "../lib/checkpoint-page";
export { VERSION_RETENTION } from "../lib/checkpoint-page";

export const writeTestPageBody = useCase
	.command("tests.writePageBody")
	.input(SavePageContentInputSchema)
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

			await checkpointPageBeforeWrite(tx, scope, page.id, user.id);

			const result = await tx.pages.restoreContent(
				scope,
				input.id,
				input.content,
			);

			// The saved document is the source of truth for its task blocks and
			// outgoing page links.
			const derivations = await reconcilePageDerivations(
				tx,
				scope,
				page,
				input.content,
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

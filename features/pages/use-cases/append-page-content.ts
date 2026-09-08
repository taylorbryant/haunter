import "@beignet/core/server-only";
import { z } from "zod";
import { scheduleWorkspacePageEvent } from "@/features/collab/server/workspace-events";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { reconcilePageDerivations } from "../lib/apply-page-content";
import { checkpointPageBeforeWrite } from "../lib/checkpoint-page";
import { PageContentSchema, SavePageContentOutputSchema } from "../schemas";

/** Agent appends express intent without sending a stale copy of the whole page. */
export const appendPageContentUseCase = useCase
	.command("pages.appendContent")
	.input(z.object({ id: z.uuid(), content: PageContentSchema.min(1) }))
	.output(SavePageContentOutputSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		const scope = requireActiveWorkspaceScope(ctx);
		const { output, assignmentNotifications, workspaceId } =
			await ctx.ports.uow.transaction(async (tx) => {
				const page = await tx.pages.findMetaById(scope, input.id);
				if (!page || page.deletedAt !== null) throw appError("PageNotFound");
				await ctx.gate.authorize("pages.update", page);
				await checkpointPageBeforeWrite(tx, scope, page.id, user.id);
				const { content, ...saved } = await tx.pages.appendContent(
					scope,
					page.id,
					input.content,
				);
				const { assignmentNotifications, ...derived } =
					await reconcilePageDerivations(tx, scope, page, content, {
						assignmentUser: user,
						defaultTaskAssigneeId: user.id,
					});
				return {
					output: { ...saved, ...derived },
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

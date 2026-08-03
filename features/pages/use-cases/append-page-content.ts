import "@beignet/core/server-only";
import { z } from "zod";
import { appendPageBlocks } from "@/features/documents/codec";
import { mutateCollaborativeDocument } from "@/features/documents/service";
import { appError } from "@/features/shared/errors";
import {
	resolveTaskAssignmentActor,
	scheduleTaskAssignmentDelivery,
} from "@/features/tasks/notifications/assigned";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { PageContentSchema, SavePageContentOutputSchema } from "../schemas";

/** Internal append command used by agent capabilities. The public page-save
 * contract remains a whole-document replacement for imports and restores. */
export const appendPageContentUseCase = useCase
	.command("pages.appendContent")
	.input(
		z.object({
			id: z.string().uuid(),
			content: PageContentSchema.min(1),
		}),
	)
	.output(SavePageContentOutputSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		const scope = requireActiveWorkspaceScope(ctx);
		const page = await ctx.ports.pages.findById(scope, input.id);
		if (!page || page.deletedAt !== null) {
			throw appError("PageNotFound", { details: { id: input.id } });
		}
		await ctx.gate.authorize("pages.update", page);
		const result = await mutateCollaborativeDocument({
			scope,
			kind: "page",
			entityId: page.id,
			ports: ctx.ports,
			assignmentActor: await resolveTaskAssignmentActor(
				ctx.ports.members,
				scope,
				user,
			),
			defaultTaskAssigneeId: user.id,
			apply(doc) {
				if (appendPageBlocks(doc, input.content) === 0) {
					throw appError("InvalidPageContent");
				}
			},
		});
		if (result.kind !== "page") {
			throw new Error(`Expected a page projection for ${page.id}`);
		}
		scheduleTaskAssignmentDelivery(ctx, result.assignmentNotifications);
		return {
			updatedAt: result.updatedAt,
			contentUpdatedAt: result.contentUpdatedAt,
			tasksChanged: result.tasksChanged,
			linksChanged: result.linksChanged,
		};
	});

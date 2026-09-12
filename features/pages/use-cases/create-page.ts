import "@beignet/core/server-only";
import { scheduleWorkspacePageEvent } from "@/features/collab/server/workspace-events";
import type { Notification } from "@/features/notifications/schemas";
import {
	reconcilePageDerivations,
	reconcilePageLinks,
} from "@/features/pages/lib/apply-page-content";
import { createSubpageLinkBlock } from "@/features/pages/lib/subpage-link-block";
import type { Page } from "@/features/pages/schemas";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { CreatePageInputSchema, CreatePageOutputSchema } from "../schemas";

export const createPageUseCase = useCase
	.command("pages.create")
	.input(CreatePageInputSchema)
	.output(CreatePageOutputSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		await ctx.gate.authorize("pages.create");
		const scope = requireActiveWorkspaceScope(ctx, input.workspaceId);

		const { page: result, assignmentNotifications } =
			await ctx.ports.uow.transaction(async (tx) => {
				const parentPageId = input.parentPageId ?? null;
				let parentContentUpdatedAt: string | null = null;
				let assignmentNotifications: Notification[] = [];
				let parent: Page | null = null;
				if (parentPageId) {
					parent = await tx.pages.findById(scope, parentPageId);
					if (!parent || parent.deletedAt !== null) {
						throw appError("PageNotFound", { details: { id: parentPageId } });
					}
					await ctx.gate.authorize("pages.update", parent);
				}

				const position =
					(await tx.pages.maxPositionForParent(scope, parentPageId)) + 1;

				const created = await tx.pages.create(scope, {
					userId: user.id,
					parentPageId,
					title: input.title,
					position,
					initialContent: input.initialContent,
				});

				if (input.initialContent && input.initialContent.length > 0) {
					const derivations = await reconcilePageDerivations(
						tx,
						scope,
						created,
						input.initialContent,
						{
							assignmentUser: user,
							defaultTaskAssigneeId: user.id,
						},
					);
					assignmentNotifications = derivations.assignmentNotifications;
				}

				if (parent && input.appendToParentContent !== false) {
					const pageLinkBlock = createSubpageLinkBlock(created);
					const saved = await tx.pages.appendContent(scope, parent.id, [
						pageLinkBlock,
					]);
					parentContentUpdatedAt = saved.contentUpdatedAt;
					await reconcilePageLinks(tx, scope, parent, saved.content);
				}

				return {
					page: { ...created, parentContentUpdatedAt },
					assignmentNotifications,
				};
			});

		ctx.ports.taskAssignmentDelivery.schedule(assignmentNotifications);

		scheduleWorkspacePageEvent(ctx, {
			type: "page.created",
			workspaceId: result.workspaceId,
			pageId: result.id,
			...(result.parentPageId
				? { affectedPageIds: [result.parentPageId] }
				: {}),
		});
		return result;
	});

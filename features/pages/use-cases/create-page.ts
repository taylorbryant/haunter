import "@beignet/core/server-only";
import { enqueueJob } from "@beignet/core/outbox";
import { scheduleWorkspacePageEvent } from "@/features/collab/server/workspace-events";
import { appendSubpageLink } from "@/features/documents/codec";
import {
	AppendSubpageLinkJob,
	EnsureDocumentJob,
} from "@/features/documents/jobs";
import {
	ensureCollaborativeDocument,
	mutateCollaborativeDocument,
} from "@/features/documents/service";
import type { Notification } from "@/features/notifications/schemas";
import { reconcilePageDerivations } from "@/features/pages/lib/apply-page-content";
import { extractPageSearchText } from "@/features/pages/lib/extract-page-text";
import type { Page } from "@/features/pages/schemas";
import { appError } from "@/features/shared/errors";
import {
	resolveTaskAssignmentActor,
	scheduleTaskAssignmentDelivery,
} from "@/features/tasks/notifications/assigned";
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

		const { page: createdPage, assignmentNotifications } =
			await ctx.ports.uow.transaction(async (tx) => {
				const parentPageId = input.parentPageId ?? null;
				const parentContentUpdatedAt: string | null = null;
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

				let created = await tx.pages.create(scope, {
					userId: user.id,
					parentPageId,
					title: input.title,
					position,
				});

				if (input.initialContent && input.initialContent.length > 0) {
					const saved = await tx.pages.saveContent(
						scope,
						created.id,
						JSON.stringify(input.initialContent),
						extractPageSearchText(input.initialContent),
					);
					const assignmentActor = await resolveTaskAssignmentActor(
						tx.members,
						scope,
						user,
					);
					const derivations = await reconcilePageDerivations(
						tx,
						scope,
						created,
						input.initialContent,
						{
							assignmentActor,
							defaultTaskAssigneeId: user.id,
						},
					);
					assignmentNotifications = derivations.assignmentNotifications;
					created = { ...created, ...saved };
				}

				await enqueueJob(tx.outbox, EnsureDocumentJob, {
					kind: "page",
					entityId: created.id,
					workspaceId: created.workspaceId,
				});
				if (parent && input.appendToParentContent !== false) {
					await enqueueJob(tx.outbox, AppendSubpageLinkJob, {
						parentPageId: parent.id,
						childPageId: created.id,
						workspaceId: created.workspaceId,
					});
				}

				return {
					page: { ...created, parentContentUpdatedAt },
					assignmentNotifications,
				};
			});

		scheduleTaskAssignmentDelivery(ctx, assignmentNotifications);
		let result: Omit<typeof createdPage, "parentContentUpdatedAt"> & {
			parentContentUpdatedAt: string | null;
		} = createdPage;

		try {
			await ensureCollaborativeDocument({
				scope,
				kind: "page",
				entityId: result.id,
				ports: ctx.ports,
			});
		} catch (error) {
			ctx.ports.logger.warn(
				"Page created; durable document seeding will retry",
				{
					pageId: result.id,
					error,
				},
			);
		}
		if (result.parentPageId && input.appendToParentContent !== false) {
			try {
				const parentProjection = await mutateCollaborativeDocument({
					scope,
					kind: "page",
					entityId: result.parentPageId,
					ports: ctx.ports,
					apply(doc) {
						appendSubpageLink(doc, result);
					},
				});
				if (parentProjection.kind === "page") {
					result = {
						...result,
						parentContentUpdatedAt: parentProjection.contentUpdatedAt,
					};
				}
			} catch (error) {
				ctx.ports.logger.warn(
					"Page created; durable parent-link propagation will retry",
					{
						pageId: result.id,
						parentPageId: result.parentPageId,
						error,
					},
				);
			}
		}

		scheduleWorkspacePageEvent(ctx, {
			type: "page.created",
			workspaceId: result.workspaceId,
			pageId: result.id,
		});
		return result;
	});

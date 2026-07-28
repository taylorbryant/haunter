import "@beignet/core/server-only";
import {
	ResolveInboxItemInputSchema,
	ResolveInboxItemOutputSchema,
} from "@/features/inbox/schemas";
import { assertValidPageParent } from "@/features/pages/lib/page-move";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";

export const resolveInboxItemUseCase = useCase
	.command("inbox.resolve")
	.input(ResolveInboxItemInputSchema)
	.output(ResolveInboxItemOutputSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		const scope = requireActiveWorkspaceScope(ctx);

		return ctx.ports.uow.transaction(async (tx) => {
			const inboxItem = await tx.inboxItems.findForUser(
				scope,
				user.id,
				input.id,
			);
			if (!inboxItem) {
				throw appError("InboxItemNotFound", { details: { id: input.id } });
			}

			const resourceId = inboxItem.pageId ?? inboxItem.taskId;
			if (!resourceId) {
				throw appError("InboxItemNotFound", { details: { id: input.id } });
			}

			if (input.action === "dismiss") {
				await tx.inboxItems.deleteForUser(scope, user.id, inboxItem.id);
				return {
					id: inboxItem.id,
					kind: inboxItem.kind,
					action: input.action,
					resourceId,
				};
			}

			if (input.action === "file_page") {
				if (inboxItem.kind !== "page" || !inboxItem.pageId) {
					throw appError("InvalidInboxAction");
				}
				const page = await tx.pages.findMetaById(scope, inboxItem.pageId);
				if (!page || page.deletedAt !== null) {
					throw appError("PageNotFound", {
						details: { id: inboxItem.pageId },
					});
				}
				await ctx.gate.authorize("pages.update", page);
				await assertValidPageParent(
					tx.pages,
					scope,
					page.id,
					input.parentPageId,
				);
				const position =
					(await tx.pages.maxPositionForParent(scope, input.parentPageId)) + 1;
				await tx.pages.update(scope, page.id, {
					parentPageId: input.parentPageId,
					position,
				});
			} else {
				if (inboxItem.kind !== "task" || !inboxItem.taskId) {
					throw appError("InvalidInboxAction");
				}
				const task = await tx.tasks.findById(scope, inboxItem.taskId);
				if (!task) {
					throw appError("TaskNotFound", {
						details: { id: inboxItem.taskId },
					});
				}
				await ctx.gate.authorize("tasks.update", task);
				if (task.sourceBlockId !== null) {
					throw appError("TaskNotEditable", {
						details: { id: inboxItem.taskId },
					});
				}

				if (input.action === "schedule_task") {
					await tx.tasks.update(scope, task.id, {
						dueDate: input.dueDate,
						dueTime: input.dueTime ?? null,
					});
				} else if (input.action === "complete_task") {
					await tx.tasks.update(scope, task.id, {
						completed: true,
						completedAt: new Date().toISOString(),
					});
				} else {
					throw appError("InvalidInboxAction");
				}
			}

			await tx.inboxItems.deleteForUser(scope, user.id, inboxItem.id);
			return {
				id: inboxItem.id,
				kind: inboxItem.kind,
				action: input.action,
				resourceId,
			};
		});
	});

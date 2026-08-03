import "@beignet/core/server-only";
import { scheduleWorkspacePageEvent } from "@/features/collab/server/workspace-events";
import {
	pageProjectionFromYDoc,
	replacePageDocument,
} from "@/features/documents/codec";
import { mutateCollaborativeDocument } from "@/features/documents/service";
import { appError } from "@/features/shared/errors";
import {
	resolveTaskAssignmentActor,
	scheduleTaskAssignmentDelivery,
} from "@/features/tasks/notifications/assigned";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { PAGE_VERSION_RETENTION } from "../lib/version-retention";
import {
	PageVersionIdInputSchema,
	SavePageContentOutputSchema,
} from "../schemas";

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

		const page = await ctx.ports.pages.findById(scope, input.id);
		if (!page || page.deletedAt !== null) {
			throw appError("PageNotFound", { details: { id: input.id } });
		}
		await ctx.gate.authorize("pages.update", page);
		const version = await ctx.ports.pageVersions.findById(
			scope,
			input.versionId,
		);
		if (!version || version.pageId !== page.id) {
			throw appError("PageNotFound", { details: { id: input.versionId } });
		}

		let previous: ReturnType<typeof pageProjectionFromYDoc> | null = null;
		const replacementGeneration = crypto.randomUUID();
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
				previous = pageProjectionFromYDoc(doc);
				replacePageDocument(
					doc,
					{ title: version.title, content: version.content },
					replacementGeneration,
				);
			},
			async beforeWrite() {
				const snapshot = previous;
				if (!snapshot) {
					throw new Error(`Failed to snapshot page ${page.id} before restore`);
				}
				await ctx.ports.uow.transaction(async (tx) => {
					await tx.pageVersions.create(scope, {
						pageId: page.id,
						title: snapshot.title,
						icon: page.icon,
						contentJson: JSON.stringify(snapshot.content),
						cause: "restore",
						createdBy: user.id,
					});
					await tx.pageVersions.prune(scope, page.id, PAGE_VERSION_RETENTION);
				});
			},
		});
		if (version.icon !== page.icon) {
			await ctx.ports.pages.update(scope, page.id, { icon: version.icon });
		}
		if (result.kind !== "page") {
			throw new Error(`Expected a page projection for ${page.id}`);
		}
		if (result.titleChanged) {
			scheduleWorkspacePageEvent(ctx, {
				type: "page.renamed",
				workspaceId: page.workspaceId,
				pageId: page.id,
			});
		}
		if (version.icon !== page.icon) {
			scheduleWorkspacePageEvent(ctx, {
				type: "page.iconChanged",
				workspaceId: page.workspaceId,
				pageId: page.id,
			});
		}
		scheduleTaskAssignmentDelivery(ctx, result.assignmentNotifications);
		return {
			updatedAt: result.updatedAt,
			contentUpdatedAt: result.contentUpdatedAt,
			tasksChanged: result.tasksChanged,
			linksChanged: result.linksChanged,
		};
	});

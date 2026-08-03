import "@beignet/core/server-only";
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
import {
	PAGE_CHECKPOINT_INTERVAL_MS,
	PAGE_VERSION_RETENTION,
} from "../lib/version-retention";
import {
	SavePageContentInputSchema,
	SavePageContentOutputSchema,
} from "../schemas";

export const savePageContentUseCase = useCase
	.command("pages.saveContent")
	.input(SavePageContentInputSchema)
	.output(SavePageContentOutputSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		const scope = requireActiveWorkspaceScope(ctx);
		const page = await ctx.ports.pages.findById(scope, input.id);
		if (!page || page.deletedAt !== null) {
			throw appError("PageNotFound", { details: { id: input.id } });
		}
		await ctx.gate.authorize("pages.update", page);

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
				const snapshot = pageProjectionFromYDoc(doc);
				previous = snapshot;
				replacePageDocument(
					doc,
					{ title: snapshot.title, content: input.content },
					replacementGeneration,
				);
			},
			async beforeWrite() {
				const snapshot = previous;
				if (!snapshot) {
					throw new Error(`Failed to snapshot page ${page.id} before save`);
				}
				await ctx.ports.uow.transaction(async (tx) => {
					const latestVersionAt = await tx.pageVersions.latestCreatedAt(
						scope,
						page.id,
					);
					const due =
						latestVersionAt === null ||
						Date.now() - Date.parse(latestVersionAt) >=
							PAGE_CHECKPOINT_INTERVAL_MS;
					if (due && snapshot.content.length > 0) {
						await tx.pageVersions.create(scope, {
							pageId: page.id,
							title: snapshot.title,
							icon: page.icon,
							contentJson: JSON.stringify(snapshot.content),
							cause: "checkpoint",
							createdBy: user.id,
						});
						await tx.pageVersions.prune(scope, page.id, PAGE_VERSION_RETENTION);
					}
				});
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

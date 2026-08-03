import "@beignet/core/server-only";
import { enqueueJob } from "@beignet/core/outbox";
import { MaterializeDocumentJob } from "@/features/documents/jobs";
import { ensureCollaborativeDocument } from "@/features/documents/service";
import { appError } from "@/features/shared/errors";
import { resolveTaskAssignmentActor } from "@/features/tasks/notifications/assigned";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import {
	QueueDocumentMaterializationInputSchema,
	QueueDocumentMaterializationOutputSchema,
} from "../schemas";

export const queueDocumentMaterializationUseCase = useCase
	.command("documents.queueMaterialization")
	.input(QueueDocumentMaterializationInputSchema)
	.output(QueueDocumentMaterializationOutputSchema)
	.run(async ({ ctx, input }) => {
		const scope = requireActiveWorkspaceScope(ctx);
		const taskAttributions = input.taskAttributions ?? [];
		if (input.kind !== "page" && taskAttributions.length > 0) {
			throw appError("Forbidden", {
				message: "Task attribution is only valid for page documents.",
			});
		}
		let workspaceId: string;
		if (input.kind === "page") {
			const page = await ctx.ports.pages.findMetaById(scope, input.id);
			if (!page || page.deletedAt !== null) throw appError("Forbidden");
			await ctx.gate.authorize("pages.update", page);
			workspaceId = page.workspaceId;
		} else {
			const canvas = await ctx.ports.canvases.findById(scope, input.id);
			if (!canvas) throw appError("Forbidden");
			await ctx.gate.authorize("canvases.update", canvas);
			const page = await ctx.ports.pages.findMetaById(scope, canvas.pageId);
			if (!page || page.deletedAt !== null) throw appError("Forbidden");
			workspaceId = canvas.workspaceId;
		}
		// An existing browser can remain connected while a transient server-side
		// provider error marks the registry unhealthy. Verify and repair the room
		// here so its next projection request recovers instead of failing forever.
		const registered = await ensureCollaborativeDocument({
			scope,
			kind: input.kind,
			entityId: input.id,
			ports: ctx.ports,
			verifyReady: true,
		});
		await ctx.ports.uow.transaction(async (tx) => {
			const actor =
				taskAttributions.length > 0
					? await resolveTaskAssignmentActor(
							tx.members,
							scope,
							requireUser(ctx),
						)
					: null;
			if (actor) {
				await tx.documents.recordTaskAttributions(
					scope,
					registered.documentId,
					taskAttributions.map((attribution) => ({
						...attribution,
						actorUserId: actor.userId,
						actorName: actor.name,
					})),
				);
			}
			await enqueueJob(tx.outbox, MaterializeDocumentJob, {
				documentId: registered.documentId,
				workspaceId,
			});
		});
		return { queued: true } as const;
	});

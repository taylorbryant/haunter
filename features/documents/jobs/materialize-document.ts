import { retry } from "@beignet/core/jobs";
import { createTenant, createTenantScope } from "@beignet/core/ports";
import { z } from "zod";
import { parseRoomId } from "@/features/collab/lib/room";
import { publishWorkspacePageEvent } from "@/features/collab/server/workspace-events";
import { pageMaterializationEventType } from "@/features/documents/materialization-event";
import { materializeCollaborativeDocument } from "@/features/documents/service";
import { deliverTaskAssignmentNotifications } from "@/features/tasks/notifications/assigned";
import { defineJob } from "@/lib/jobs";

export const MaterializeDocumentPayloadSchema = z.object({
	documentId: z.string().min(1),
	workspaceId: z.string().min(1),
	taskAttributions: z
		.array(
			z.object({
				blockId: z.string().min(1),
				assignee: z.string().min(1),
				operationId: z.string().uuid().optional(),
				actor: z.object({
					userId: z.string().min(1),
					name: z.string().min(1),
				}),
			}),
		)
		.optional(),
});

export const MaterializeDocumentJob = defineJob("documents.materialize", {
	payload: MaterializeDocumentPayloadSchema,
	retry: retry.exponential({
		attempts: 5,
		initialDelay: "1s",
		maxDelay: "1m",
	}),
	async handle({ payload, ctx }) {
		const scope = createTenantScope(createTenant(payload.workspaceId));
		// Keep older queued payloads parseable during a rolling deployment. Only
		// operation-bound entries are safe to promote into durable attribution.
		const legacyAttributions = payload.taskAttributions?.filter(
			(
				attribution,
			): attribution is typeof attribution & { operationId: string } =>
				attribution.operationId !== undefined,
		);
		if (legacyAttributions?.length) {
			await ctx.ports.uow.transaction((tx) =>
				tx.documents.recordTaskAttributions(
					scope,
					payload.documentId,
					legacyAttributions.map((attribution) => ({
						blockId: attribution.blockId,
						assignee: attribution.assignee,
						operationId: attribution.operationId,
						actorUserId: attribution.actor.userId,
						actorName: attribution.actor.name,
					})),
				),
			);
		}
		const result = await materializeCollaborativeDocument({
			scope,
			documentId: payload.documentId,
			ports: ctx.ports,
		});
		if (result.kind === "page" && result.assignmentNotifications.length > 0) {
			try {
				await deliverTaskAssignmentNotifications(
					ctx,
					result.assignmentNotifications,
				);
			} catch (error) {
				ctx.ports.logger.warn(
					"Document materialized, but assignment push delivery failed",
					{
						documentId: payload.documentId,
						error,
					},
				);
			}
		}
		if (result.kind === "page") {
			const eventType = pageMaterializationEventType(result);
			const target = parseRoomId(payload.documentId);
			if (eventType && target?.kind === "page") {
				await publishWorkspacePageEvent(ctx, {
					type: eventType,
					workspaceId: payload.workspaceId,
					pageId: target.id,
				});
			}
		}
		ctx.ports.logger.info("Collaborative document materialized", {
			documentId: payload.documentId,
			workspaceId: payload.workspaceId,
			status: result.status,
		});
	},
});

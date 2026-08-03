import { retry } from "@beignet/core/jobs";
import { createTenant, createTenantScope } from "@beignet/core/ports";
import { z } from "zod";
import { ensureCollaborativeDocument } from "@/features/documents/service";
import { defineJob } from "@/lib/jobs";
import { DocumentKindSchema } from "../schemas";

export const EnsureDocumentPayloadSchema = z.object({
	kind: DocumentKindSchema,
	entityId: z.string().uuid(),
	workspaceId: z.string().min(1),
});

/** Durable completion for creates that committed their backwards-compatible
 * SQLite projection before the collaboration provider became unavailable. */
export const EnsureDocumentJob = defineJob("documents.ensure", {
	payload: EnsureDocumentPayloadSchema,
	retry: retry.exponential({
		attempts: 10,
		initialDelay: "1s",
		maxDelay: "5m",
	}),
	async handle({ payload, ctx }) {
		const scope = createTenantScope(createTenant(payload.workspaceId));
		const source =
			payload.kind === "page"
				? await ctx.ports.pages.findMetaById(scope, payload.entityId)
				: await ctx.ports.canvases.findById(scope, payload.entityId);
		if (!source || ("deletedAt" in source && source.deletedAt !== null)) return;
		await ensureCollaborativeDocument({
			scope,
			kind: payload.kind,
			entityId: payload.entityId,
			ports: ctx.ports,
		});
	},
});

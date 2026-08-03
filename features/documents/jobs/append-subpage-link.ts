import { retry } from "@beignet/core/jobs";
import { createTenant, createTenantScope } from "@beignet/core/ports";
import { z } from "zod";
import { appendSubpageLink } from "@/features/documents/codec";
import { mutateCollaborativeDocument } from "@/features/documents/service";
import { defineJob } from "@/lib/jobs";

export const AppendSubpageLinkPayloadSchema = z.object({
	parentPageId: z.string().uuid(),
	childPageId: z.string().uuid(),
	workspaceId: z.string().min(1),
});

/** Idempotently mirrors page creation into the authoritative parent Ydoc. */
export const AppendSubpageLinkJob = defineJob("documents.appendSubpageLink", {
	payload: AppendSubpageLinkPayloadSchema,
	retry: retry.exponential({
		attempts: 10,
		initialDelay: "1s",
		maxDelay: "5m",
	}),
	async handle({ payload, ctx }) {
		const scope = createTenantScope(createTenant(payload.workspaceId));
		const [parent, child] = await Promise.all([
			ctx.ports.pages.findMetaById(scope, payload.parentPageId),
			ctx.ports.pages.findMetaById(scope, payload.childPageId),
		]);
		if (
			!parent ||
			parent.deletedAt !== null ||
			!child ||
			child.deletedAt !== null ||
			child.parentPageId !== parent.id
		) {
			return;
		}
		await mutateCollaborativeDocument({
			scope,
			kind: "page",
			entityId: parent.id,
			ports: ctx.ports,
			apply(doc) {
				appendSubpageLink(doc, child);
			},
		});
	},
});

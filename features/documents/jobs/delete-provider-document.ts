import { retry } from "@beignet/core/jobs";
import { z } from "zod";
import { defineJob } from "@/lib/jobs";

export const DeleteProviderDocumentPayloadSchema = z.object({
	documentId: z.string().min(1),
});

/** Provider deletion is deliberately independent of the document registry:
 * purge removes the registry row in the same transaction that enqueues this
 * job, leaving the outbox record as the durable retry tombstone. */
export const DeleteProviderDocumentJob = defineJob(
	"documents.deleteProviderDocument",
	{
		payload: DeleteProviderDocumentPayloadSchema,
		retry: retry.exponential({
			attempts: 10,
			initialDelay: "1s",
			maxDelay: "5m",
		}),
		async handle({ payload, ctx }) {
			await ctx.ports.documentStore.deleteDocument(payload.documentId);
			ctx.ports.logger.info("Purged collaborative document from provider", {
				documentId: payload.documentId,
			});
		},
	},
);

import { defineContractGroup } from "@beignet/core/contracts";
import { z } from "zod";
import { errors } from "@/features/shared/errors";
import {
	DocumentPathSchema,
	QueueDocumentMaterializationBodySchema,
	QueueDocumentMaterializationOutputSchema,
} from "./schemas";

const documents = defineContractGroup()
	.namespace("documents")
	.meta({ auth: "required" })
	.errors({ Unauthorized: errors.Unauthorized })
	.responses({
		500: z.object({
			code: z.string(),
			message: z.string(),
			requestId: z.string().optional(),
		}),
	});

export const queueDocumentMaterialization = documents
	.post("/api/documents/:kind/:id/materialize")
	.pathParams(DocumentPathSchema)
	.body(QueueDocumentMaterializationBodySchema.optional())
	.errors({ Forbidden: errors.Forbidden })
	.responses({ 202: QueueDocumentMaterializationOutputSchema });

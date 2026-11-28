import { defineContractGroup } from "@beignet/core/contracts";
import { z } from "zod";
import { errors } from "@/features/shared/errors";
import {
	ImportRecoveryInputSchema,
	ImportRecoveryOutputSchema,
	StageRecoveryPartInputSchema,
} from "./recovery";

export const importRecovery = defineContractGroup()
	.namespace("documents")
	.meta({
		auth: "required",
		idempotency: { header: "idempotency-key", scope: "actor" },
		rateLimit: { max: 20, windowSec: 60, scope: "user" },
	})
	.post("/api/document-recoveries")
	.body(ImportRecoveryInputSchema)
	.errors({
		Unauthorized: errors.Unauthorized,
		Forbidden: errors.Forbidden,
		InvalidPageContent: errors.InvalidPageContent,
	})
	.responses({ 200: ImportRecoveryOutputSchema });

export const stageRecoveryPart = defineContractGroup()
	.namespace("documents")
	.meta({
		auth: "required",
		rateLimit: { max: 30, windowSec: 60, scope: "user" },
	})
	.post("/api/document-recovery-parts")
	.body(StageRecoveryPartInputSchema)
	.errors({
		Unauthorized: errors.Unauthorized,
		Forbidden: errors.Forbidden,
		InvalidPageContent: errors.InvalidPageContent,
	})
	.responses({ 200: z.object({ staged: z.literal(true) }) });

export const openDocumentSession = defineContractGroup()
	.namespace("documents")
	.meta({ auth: "required" })
	.post("/api/pages/:id/document-session")
	.pathParams(z.object({ id: z.uuid() }))
	.body(z.object({}))
	.errors({
		Unauthorized: errors.Unauthorized,
		Forbidden: errors.Forbidden,
		PageNotFound: errors.PageNotFound,
		InvalidPageContent: errors.InvalidPageContent,
	})
	.responses({
		200: z.object({
			token: z.string(),
			generation: z.number().int().nonnegative(),
		}),
	});

export const openCanvasSession = defineContractGroup()
	.namespace("documents")
	.meta({ auth: "required" })
	.post("/api/canvases/:id/sync-session")
	.pathParams(z.object({ id: z.uuid() }))
	.body(z.object({}))
	.errors({
		Unauthorized: errors.Unauthorized,
		Forbidden: errors.Forbidden,
		CanvasNotFound: errors.CanvasNotFound,
		InvalidPageContent: errors.InvalidPageContent,
	})
	.responses({
		200: z.object({
			token: z.string(),
			generation: z.number().int().nonnegative(),
		}),
	});

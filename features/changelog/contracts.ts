import { defineContractGroup } from "@beignet/core/contracts";
import { z } from "zod";
import { errors } from "@/features/shared/errors";
import {
	ChangelogStatusSchema,
	MarkChangelogSeenOutputSchema,
} from "./schemas";

const ErrorResponseSchema = z.object({
	code: z.string(),
	message: z.string(),
	requestId: z.string().optional(),
});

const changelog = defineContractGroup()
	.namespace("changelog")
	.meta({ auth: "required" })
	.errors({
		Forbidden: errors.Forbidden,
		Unauthorized: errors.Unauthorized,
	})
	.responses({ 500: ErrorResponseSchema });

export const getChangelogStatus = changelog
	.get("/api/changelog/status")
	.responses({ 200: ChangelogStatusSchema });

export const markChangelogSeen = changelog
	.post("/api/changelog/seen")
	.body(z.object({}))
	.responses({ 200: MarkChangelogSeenOutputSchema });

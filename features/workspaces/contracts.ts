import { defineContractGroup } from "@beignet/core/contracts";
import { z } from "zod";
import { errors } from "@/features/shared/errors";
import {
	OnboardInputSchema,
	OnboardOutputSchema,
} from "@/features/workspaces/schemas";

const ErrorResponseSchema = z.object({
	code: z.string(),
	message: z.string(),
	requestId: z.string().optional(),
});

const workspaces = defineContractGroup()
	.namespace("workspaces")
	.errors({ Unauthorized: errors.Unauthorized })
	.responses({
		500: ErrorResponseSchema,
	});

// Idempotent first-run: seed the active workspace (a Better Auth organization,
// created client-side at sign-up) with example pages, or return it unchanged
// when the user has already been onboarded.
export const onboard = workspaces
	.post("/api/onboarding")
	.body(OnboardInputSchema)
	.meta({ rateLimit: { max: 5, windowSec: 300, scope: "user" } })
	.errors({ Forbidden: errors.Forbidden })
	.responses({
		200: OnboardOutputSchema,
	});

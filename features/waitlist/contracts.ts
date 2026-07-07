import { defineContractGroup } from "@beignet/core/contracts";
import { z } from "zod";
import {
	RequestAccessInputSchema,
	RequestAccessOutputSchema,
} from "@/features/waitlist/schemas";

const ErrorResponseSchema = z.object({
	code: z.string(),
	message: z.string(),
	requestId: z.string().optional(),
});

const waitlist = defineContractGroup().namespace("waitlist").responses({
	500: ErrorResponseSchema,
});

// Public: existing users continue to OTP sign-in; unknown emails are waitlisted.
export const requestAccess = waitlist
	.post("/api/waitlist")
	.body(RequestAccessInputSchema)
	.meta({ rateLimit: { max: 10, windowSec: 60, scope: "ip" } })
	.responses({
		200: RequestAccessOutputSchema,
	});


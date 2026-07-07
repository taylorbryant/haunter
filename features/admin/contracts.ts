import { defineContractGroup } from "@beignet/core/contracts";
import { z } from "zod";
import {
	ApproveWaitlistUserOutputSchema,
	ListWaitlistOutputSchema,
} from "@/features/admin/schemas";
import { errors } from "@/features/shared/errors";

const ErrorResponseSchema = z.object({
	code: z.string(),
	message: z.string(),
	requestId: z.string().optional(),
});

const admin = defineContractGroup()
	.namespace("admin")
	.errors({ Unauthorized: errors.Unauthorized, Forbidden: errors.Forbidden })
	.responses({
		500: ErrorResponseSchema,
	});

// List everyone still on the waitlist. Admin-only (enforced in the use-case).
export const listWaitlist = admin
	.get("/api/admin/waitlist")
	.responses({
		200: ListWaitlistOutputSchema,
	});

// Approve a waitlisted user: flips their access status and emails them.
export const approveWaitlistUser = admin
	.post("/api/admin/waitlist/:userId/approve")
	.pathParams(z.object({ userId: z.string().min(1) }))
	.meta({ rateLimit: { max: 60, windowSec: 60, scope: "user" } })
	.errors({ UserNotFound: errors.UserNotFound })
	.responses({
		200: ApproveWaitlistUserOutputSchema,
	});

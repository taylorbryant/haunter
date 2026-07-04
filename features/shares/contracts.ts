import { defineContractGroup } from "@beignet/core/contracts";
import { z } from "zod";
import { errors } from "@/features/shared/errors";
import {
	GetPageShareOutputSchema,
	PageIdInputSchema,
	PageShareSchema,
	SharedPageSchema,
	SharedTokenInputSchema,
} from "@/features/shares/schemas";

const ErrorResponseSchema = z.object({
	code: z.string(),
	message: z.string(),
	requestId: z.string().optional(),
});

const shares = defineContractGroup().namespace("shares").responses({
	500: ErrorResponseSchema,
});

export const getPageShare = shares
	.get("/api/pages/:pageId/share")
	.pathParams(PageIdInputSchema)
	.errors({
		Unauthorized: errors.Unauthorized,
		Forbidden: errors.Forbidden,
		PageNotFound: errors.PageNotFound,
	})
	.responses({
		200: GetPageShareOutputSchema,
	});

// Idempotent: returns the existing link when the page is already shared.
export const createPageShare = shares
	.post("/api/pages/:pageId/share")
	.pathParams(PageIdInputSchema)
	.body(z.object({}))
	.errors({
		Unauthorized: errors.Unauthorized,
		Forbidden: errors.Forbidden,
		PageNotFound: errors.PageNotFound,
	})
	.responses({
		200: PageShareSchema,
	});

export const revokePageShare = shares
	.delete("/api/pages/:pageId/share")
	.pathParams(PageIdInputSchema)
	.errors({
		Unauthorized: errors.Unauthorized,
		Forbidden: errors.Forbidden,
		PageNotFound: errors.PageNotFound,
	})
	.responses({
		204: null,
	});

// Public: the token is the authorization; no session required.
export const getSharedPage = shares
	.get("/api/shared/:token")
	.pathParams(SharedTokenInputSchema)
	.errors({
		ShareNotFound: errors.ShareNotFound,
	})
	.responses({
		200: SharedPageSchema,
	});

import { defineContractGroup } from "@beignet/core/contracts";
import { z } from "zod";
import { errors } from "@/features/shared/errors";
import { ErrorResponseSchema } from "@/features/shared/schemas";
import {
	GetPageShareOutputSchema,
	PageIdInputSchema,
	PageShareSchema,
	SharedCanvasInputSchema,
	SharedCanvasSchema,
	SharedPageSchema,
	SharedTokenInputSchema,
} from "@/features/shares/schemas";

const shares = defineContractGroup().namespace("shares").responses({
	500: ErrorResponseSchema,
});

export const getPageShare = shares
	.get("/api/pages/:pageId/share")
	.pathParams(PageIdInputSchema)
	.meta({ auth: "required" })
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
	.meta({
		auth: "required",
		rateLimit: { max: 30, windowSec: 60, scope: "user" },
	})
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
	.meta({ auth: "required" })
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
	.meta({ rateLimit: { max: 120, windowSec: 60, scope: "ip" } })
	.errors({
		ShareNotFound: errors.ShareNotFound,
	})
	.responses({
		200: SharedPageSchema,
	});

// Public: a canvas embedded in a shared page, readable via the page's token.
export const getSharedCanvas = shares
	.get("/api/shared/:token/canvases/:id")
	.pathParams(SharedCanvasInputSchema)
	.meta({ rateLimit: { max: 240, windowSec: 60, scope: "ip" } })
	.errors({
		ShareNotFound: errors.ShareNotFound,
	})
	.responses({
		200: SharedCanvasSchema,
	});

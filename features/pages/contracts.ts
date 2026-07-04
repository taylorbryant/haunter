import { defineContractGroup } from "@beignet/core/contracts";
import { z } from "zod";
import { errors } from "@/features/shared/errors";
import {
	CreatePageInputSchema,
	ListBacklinksOutputSchema,
	ListPagesOutputSchema,
	ListTrashOutputSchema,
	PageIdInputSchema,
	PageMetaSchema,
	PageSchema,
	SavePageContentBodySchema,
	SavePageContentOutputSchema,
	SearchPagesInputSchema,
	SearchPagesOutputSchema,
	UpdatePageBodySchema,
} from "@/features/pages/schemas";

const ErrorResponseSchema = z.object({
	code: z.string(),
	message: z.string(),
	requestId: z.string().optional(),
});

const pages = defineContractGroup()
	.namespace("pages")
	.errors({ Unauthorized: errors.Unauthorized })
	.responses({
		500: ErrorResponseSchema,
	});

export const listPages = pages
	.get("/api/workspaces/:workspaceId/pages")
	.pathParams(z.object({ workspaceId: z.string().min(1) }))
	.errors({
		Forbidden: errors.Forbidden,
		WorkspaceNotFound: errors.WorkspaceNotFound,
	})
	.responses({
		200: ListPagesOutputSchema,
	});

export const createPage = pages
	.post("/api/pages")
	.body(CreatePageInputSchema)
	.meta({ idempotency: { header: "idempotency-key", scope: "actor" } })
	.errors({
		Forbidden: errors.Forbidden,
		WorkspaceNotFound: errors.WorkspaceNotFound,
		PageNotFound: errors.PageNotFound,
	})
	.responses({
		201: PageMetaSchema,
	});

export const getPage = pages
	.get("/api/pages/:id")
	.pathParams(PageIdInputSchema)
	.errors({
		Forbidden: errors.Forbidden,
		PageNotFound: errors.PageNotFound,
	})
	.responses({
		200: PageSchema,
	});

export const updatePage = pages
	.patch("/api/pages/:id")
	.pathParams(PageIdInputSchema)
	.body(UpdatePageBodySchema)
	.errors({
		Forbidden: errors.Forbidden,
		PageNotFound: errors.PageNotFound,
		InvalidPageMove: errors.InvalidPageMove,
	})
	.responses({
		200: PageMetaSchema,
	});

export const savePageContent = pages
	.put("/api/pages/:id/content")
	.pathParams(PageIdInputSchema)
	.body(SavePageContentBodySchema)
	.errors({
		Forbidden: errors.Forbidden,
		PageNotFound: errors.PageNotFound,
	})
	.responses({
		200: SavePageContentOutputSchema,
	});

// Pages whose documents link to this one (pageLink blocks or @-mentions).
export const listBacklinks = pages
	.get("/api/pages/:id/backlinks")
	.pathParams(PageIdInputSchema)
	.errors({
		Forbidden: errors.Forbidden,
		PageNotFound: errors.PageNotFound,
	})
	.responses({
		200: ListBacklinksOutputSchema,
	});

// Quick-find across every workspace the user owns; trashed pages excluded.
export const searchPages = pages
	.get("/api/search")
	.query(SearchPagesInputSchema)
	.responses({
		200: SearchPagesOutputSchema,
	});

// Soft delete: moves the page and its subtree to the workspace trash.
export const deletePage = pages
	.delete("/api/pages/:id")
	.pathParams(PageIdInputSchema)
	.errors({
		Forbidden: errors.Forbidden,
		PageNotFound: errors.PageNotFound,
	})
	.responses({
		204: null,
	});

export const listTrash = pages
	.get("/api/workspaces/:workspaceId/trash")
	.pathParams(z.object({ workspaceId: z.string().min(1) }))
	.errors({
		Forbidden: errors.Forbidden,
		WorkspaceNotFound: errors.WorkspaceNotFound,
	})
	.responses({
		200: ListTrashOutputSchema,
	});

export const restorePage = pages
	.post("/api/pages/:id/restore")
	.pathParams(PageIdInputSchema)
	.errors({
		Forbidden: errors.Forbidden,
		PageNotFound: errors.PageNotFound,
	})
	.responses({
		200: PageMetaSchema,
	});

export const purgePage = pages
	.delete("/api/pages/:id/permanent")
	.pathParams(PageIdInputSchema)
	.errors({
		Forbidden: errors.Forbidden,
		PageNotFound: errors.PageNotFound,
	})
	.responses({
		204: null,
	});

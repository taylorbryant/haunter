import { defineContractGroup } from "@beignet/core/contracts";
import { z } from "zod";
import {
	CreatePageInputSchema,
	ListBacklinksOutputSchema,
	ListPagesOutputSchema,
	ListPageVersionsOutputSchema,
	ListTrashOutputSchema,
	PageIdInputSchema,
	PageMetaSchema,
	PageSchema,
	PageVersionIdInputSchema,
	PageVersionSchema,
	SavePageContentBodySchema,
	SavePageContentOutputSchema,
	SearchPagesInputSchema,
	SearchPagesOutputSchema,
	UpdatePageBodySchema,
} from "@/features/pages/schemas";
import { errors } from "@/features/shared/errors";

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
	// Autosave fires at most ~1/s per page; this is headroom, not a ceiling
	// a normal editing session should ever meet.
	.meta({ rateLimit: { max: 240, windowSec: 60, scope: "user" } })
	.errors({
		Forbidden: errors.Forbidden,
		InvalidPageContent: errors.InvalidPageContent,
		PageNotFound: errors.PageNotFound,
		StaleWrite: errors.StaleWrite,
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
	.meta({ rateLimit: { max: 60, windowSec: 60, scope: "user" } })
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

export const listPageVersions = pages
	.get("/api/pages/:id/versions")
	.pathParams(PageIdInputSchema)
	.errors({
		Forbidden: errors.Forbidden,
		PageNotFound: errors.PageNotFound,
	})
	.responses({
		200: ListPageVersionsOutputSchema,
	});

export const getPageVersion = pages
	.get("/api/pages/:id/versions/:versionId")
	.pathParams(PageVersionIdInputSchema)
	.errors({
		Forbidden: errors.Forbidden,
		PageNotFound: errors.PageNotFound,
	})
	.responses({
		200: PageVersionSchema,
	});

export const restorePageVersion = pages
	.post("/api/pages/:id/versions/:versionId/restore")
	.pathParams(PageVersionIdInputSchema)
	.body(z.object({}))
	.errors({
		Forbidden: errors.Forbidden,
		InvalidPageContent: errors.InvalidPageContent,
		PageNotFound: errors.PageNotFound,
	})
	.responses({
		200: SavePageContentOutputSchema,
	});

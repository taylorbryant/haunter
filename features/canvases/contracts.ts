import { defineContractGroup } from "@beignet/core/contracts";
import { z } from "zod";
import {
	CanvasIdInputSchema,
	CanvasNavigationOutputSchema,
	CanvasSchema,
	CreateCanvasInputSchema,
	ListCanvasesOutputSchema,
	RecordCanvasViewOutputSchema,
	SaveCanvasSnapshotBodySchema,
	SaveCanvasSnapshotOutputSchema,
	SetCanvasFavoriteBodySchema,
	SetCanvasFavoriteOutputSchema,
	UpdateCanvasBodySchema,
} from "@/features/canvases/schemas";
import { errors } from "@/features/shared/errors";
import { ErrorResponseSchema } from "@/features/shared/schemas";

const canvases = defineContractGroup()
	.namespace("canvases")
	.meta({ auth: "required" })
	.errors({ Unauthorized: errors.Unauthorized })
	.responses({
		500: ErrorResponseSchema,
	});

export const createCanvas = canvases
	.post("/api/canvases")
	.body(CreateCanvasInputSchema)
	.meta({ idempotency: { header: "idempotency-key", scope: "actor" } })
	.errors({
		Forbidden: errors.Forbidden,
		PageNotFound: errors.PageNotFound,
	})
	.responses({
		201: CanvasSchema,
	});

export const listCanvases = canvases
	.get("/api/workspaces/:workspaceId/canvases")
	.pathParams(z.object({ workspaceId: z.string().min(1) }))
	.errors({
		Forbidden: errors.Forbidden,
		WorkspaceNotFound: errors.WorkspaceNotFound,
	})
	.responses({
		200: ListCanvasesOutputSchema,
	});

export const getCanvasNavigation = canvases
	.get("/api/workspaces/:workspaceId/canvas-navigation")
	.pathParams(z.object({ workspaceId: z.string().min(1) }))
	.errors({
		Forbidden: errors.Forbidden,
		WorkspaceNotFound: errors.WorkspaceNotFound,
	})
	.responses({
		200: CanvasNavigationOutputSchema,
	});

export const setCanvasFavorite = canvases
	.put("/api/canvases/:id/favorite")
	.pathParams(CanvasIdInputSchema)
	.body(SetCanvasFavoriteBodySchema)
	.meta({ rateLimit: { max: 120, windowSec: 60, scope: "user" } })
	.errors({
		CanvasNotEditable: errors.CanvasNotEditable,
		CanvasNotFound: errors.CanvasNotFound,
		Forbidden: errors.Forbidden,
	})
	.responses({
		200: SetCanvasFavoriteOutputSchema,
	});

export const recordCanvasView = canvases
	.post("/api/canvases/:id/view")
	.pathParams(CanvasIdInputSchema)
	.body(z.object({}))
	.meta({ rateLimit: { max: 240, windowSec: 60, scope: "user" } })
	.errors({
		CanvasNotEditable: errors.CanvasNotEditable,
		CanvasNotFound: errors.CanvasNotFound,
		Forbidden: errors.Forbidden,
	})
	.responses({
		200: RecordCanvasViewOutputSchema,
	});

export const getCanvas = canvases
	.get("/api/canvases/:id")
	.pathParams(CanvasIdInputSchema)
	.errors({
		Forbidden: errors.Forbidden,
		CanvasNotFound: errors.CanvasNotFound,
	})
	.responses({
		200: CanvasSchema,
	});

export const saveCanvasSnapshot = canvases
	.put("/api/canvases/:id/snapshot")
	.pathParams(CanvasIdInputSchema)
	.body(SaveCanvasSnapshotBodySchema)
	.errors({
		Forbidden: errors.Forbidden,
		CanvasNotFound: errors.CanvasNotFound,
		StaleWrite: errors.StaleWrite,
	})
	.responses({
		200: SaveCanvasSnapshotOutputSchema,
	});

export const updateCanvas = canvases
	.patch("/api/canvases/:id")
	.pathParams(CanvasIdInputSchema)
	.body(UpdateCanvasBodySchema)
	.errors({
		CanvasNotEditable: errors.CanvasNotEditable,
		CanvasNotFound: errors.CanvasNotFound,
		Forbidden: errors.Forbidden,
	})
	.responses({
		200: CanvasSchema,
	});

export const deleteCanvas = canvases
	.delete("/api/canvases/:id")
	.pathParams(CanvasIdInputSchema)
	.errors({
		CanvasNotEditable: errors.CanvasNotEditable,
		CanvasNotFound: errors.CanvasNotFound,
		Forbidden: errors.Forbidden,
	})
	.responses({
		204: null,
	});

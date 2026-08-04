import { defineContractGroup } from "@beignet/core/contracts";
import { z } from "zod";
import {
	CanvasDetailSchema,
	CanvasIdInputSchema,
	CanvasSchema,
	CreateCanvasInputSchema,
	SaveCanvasSnapshotBodySchema,
	SaveCanvasSnapshotOutputSchema,
} from "@/features/canvases/schemas";
import { errors } from "@/features/shared/errors";

const ErrorResponseSchema = z.object({
	code: z.string(),
	message: z.string(),
	requestId: z.string().optional(),
});

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

export const getCanvas = canvases
	.get("/api/canvases/:id")
	.pathParams(CanvasIdInputSchema)
	.errors({
		Forbidden: errors.Forbidden,
		CanvasNotFound: errors.CanvasNotFound,
	})
	.responses({
		200: CanvasDetailSchema,
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

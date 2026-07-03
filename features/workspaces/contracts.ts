import { defineContractGroup } from "@beignet/core/contracts";
import { z } from "zod";
import { errors } from "@/features/shared/errors";
import {
	CreateWorkspaceInputSchema,
	ListWorkspacesOutputSchema,
	OnboardInputSchema,
	OnboardOutputSchema,
	UpdateWorkspaceBodySchema,
	WorkspaceIdInputSchema,
	WorkspaceSchema,
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

export const listWorkspaces = workspaces.get("/api/workspaces").responses({
	200: ListWorkspacesOutputSchema,
});

export const createWorkspace = workspaces
	.post("/api/workspaces")
	.body(CreateWorkspaceInputSchema)
	.meta({ idempotency: { header: "idempotency-key", scope: "actor" } })
	.errors({ Forbidden: errors.Forbidden })
	.responses({
		201: WorkspaceSchema,
	});

// Idempotent first-run: create the user's default workspace seeded with
// example pages, or return their existing workspace unchanged.
export const onboard = workspaces
	.post("/api/onboarding")
	.body(OnboardInputSchema)
	.errors({ Forbidden: errors.Forbidden })
	.responses({
		200: OnboardOutputSchema,
	});

export const updateWorkspace = workspaces
	.patch("/api/workspaces/:id")
	.pathParams(WorkspaceIdInputSchema)
	.body(UpdateWorkspaceBodySchema)
	.errors({
		Forbidden: errors.Forbidden,
		WorkspaceNotFound: errors.WorkspaceNotFound,
	})
	.responses({
		200: WorkspaceSchema,
	});

export const deleteWorkspace = workspaces
	.delete("/api/workspaces/:id")
	.pathParams(WorkspaceIdInputSchema)
	.errors({
		Forbidden: errors.Forbidden,
		WorkspaceNotFound: errors.WorkspaceNotFound,
	})
	.responses({
		204: null,
	});

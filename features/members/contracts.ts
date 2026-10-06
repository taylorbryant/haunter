import { defineContractGroup } from "@beignet/core/contracts";
import { errors } from "@/features/shared/errors";
import { ErrorResponseSchema } from "@/features/shared/schemas";
import {
	ListWorkspaceMembersInputSchema,
	ListWorkspaceMembersOutputSchema,
} from "./schemas";

export const listWorkspaceMembers = defineContractGroup()
	.namespace("members")
	.meta({ auth: "required" })
	.get("/api/workspaces/:workspaceId/members")
	.pathParams(ListWorkspaceMembersInputSchema)
	.errors({ Unauthorized: errors.Unauthorized, Forbidden: errors.Forbidden })
	.responses({
		200: ListWorkspaceMembersOutputSchema,
		500: ErrorResponseSchema,
	});

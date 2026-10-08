import {
	defineContractGroup,
	defineQueryTransport,
	query,
} from "@beignet/core/contracts";
import { z } from "zod";
import { errors } from "@/features/shared/errors";
import { SearchQuerySchema, SearchWorkspaceOutputSchema } from "./schemas";

export const searchWorkspace = defineContractGroup()
	.namespace("search")
	.get("/api/workspaces/:workspaceId/search")
	.pathParams(z.object({ workspaceId: z.string().min(1) }))
	.query(
		SearchQuerySchema,
		defineQueryTransport({
			query: query.string(),
			kind: query.string(),
			limit: query.number(),
			cursor: query.string(),
		}),
	)
	.meta({
		auth: "required",
		rateLimit: { max: 120, windowSec: 60, scope: "user" },
	})
	.errors({
		Unauthorized: errors.Unauthorized,
		Forbidden: errors.Forbidden,
		InvalidSearchCursor: errors.InvalidSearchCursor,
	})
	.responses({ 200: SearchWorkspaceOutputSchema });

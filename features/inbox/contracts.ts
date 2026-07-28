import { defineContractGroup } from "@beignet/core/contracts";
import { z } from "zod";
import {
	CaptureInboxItemInputSchema,
	InboxItemIdInputSchema,
	InboxItemSchema,
	ListInboxItemsOutputSchema,
	ListInboxItemsQuerySchema,
	ResolveInboxItemBodySchema,
	ResolveInboxItemOutputSchema,
} from "@/features/inbox/schemas";
import { errors } from "@/features/shared/errors";

const ErrorResponseSchema = z.object({
	code: z.string(),
	message: z.string(),
	requestId: z.string().optional(),
});

const inbox = defineContractGroup()
	.namespace("inbox")
	.meta({ auth: "required" })
	.errors({ Unauthorized: errors.Unauthorized })
	.responses({ 500: ErrorResponseSchema });

export const listInboxItems = inbox
	.get("/api/workspaces/:workspaceId/inbox")
	.pathParams(z.object({ workspaceId: z.string().min(1) }))
	.query(ListInboxItemsQuerySchema.partial())
	.errors({
		Forbidden: errors.Forbidden,
		WorkspaceNotFound: errors.WorkspaceNotFound,
	})
	.responses({ 200: ListInboxItemsOutputSchema });

export const captureInboxItem = inbox
	.post("/api/inbox")
	.body(CaptureInboxItemInputSchema)
	.meta({
		idempotency: { header: "idempotency-key", scope: "actor" },
		rateLimit: { max: 60, windowSec: 60, scope: "user" },
	})
	.errors({
		Forbidden: errors.Forbidden,
		WorkspaceNotFound: errors.WorkspaceNotFound,
	})
	.responses({ 201: InboxItemSchema });

export const resolveInboxItem = inbox
	.post("/api/inbox/:id/resolve")
	.pathParams(InboxItemIdInputSchema)
	.body(ResolveInboxItemBodySchema)
	.errors({
		Forbidden: errors.Forbidden,
		InboxItemNotFound: errors.InboxItemNotFound,
		InvalidInboxAction: errors.InvalidInboxAction,
		PageNotFound: errors.PageNotFound,
		TaskNotFound: errors.TaskNotFound,
		TaskNotEditable: errors.TaskNotEditable,
		InvalidPageMove: errors.InvalidPageMove,
	})
	.responses({ 200: ResolveInboxItemOutputSchema });

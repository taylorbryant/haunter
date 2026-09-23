import { createAppError, defineErrors } from "@beignet/core/errors";

export const errors = defineErrors({
	BroadcastUnavailable: {
		code: "BROADCAST_UNAVAILABLE",
		status: 503,
		message: "Live updates are temporarily unavailable",
	},
	BroadcastConnectionLimit: {
		code: "BROADCAST_CONNECTION_LIMIT",
		status: 429,
		message: "Too many live-update connections",
	},
	Unauthorized: {
		code: "UNAUTHORIZED",
		status: 401,
		message: "Authentication required",
	},
	Forbidden: {
		code: "FORBIDDEN",
		status: 403,
		message: "Forbidden",
	},
	WorkspaceNotFound: {
		code: "WORKSPACE_NOT_FOUND",
		status: 404,
		message: "Workspace not found",
	},
	PageNotFound: {
		code: "PAGE_NOT_FOUND",
		status: 404,
		message: "Page not found",
	},
	InvalidPageMove: {
		code: "INVALID_PAGE_MOVE",
		status: 422,
		message: "A page cannot be moved into itself or its descendants",
	},
	InvalidPageContent: {
		code: "INVALID_PAGE_CONTENT",
		status: 422,
		message: "This page contains invalid content",
	},
	TaskNotFound: {
		code: "TASK_NOT_FOUND",
		status: 404,
		message: "Task not found",
	},
	TaskNotEditable: {
		code: "TASK_NOT_EDITABLE",
		status: 422,
		message: "This task lives in a page; edit it in the editor",
	},
	InvalidTaskDue: {
		code: "INVALID_TASK_DUE",
		status: 422,
		message: "A due time requires a due date",
	},
	NotificationNotFound: {
		code: "NOTIFICATION_NOT_FOUND",
		status: 404,
		message: "Notification not found",
	},
	NotificationNotActionable: {
		code: "NOTIFICATION_NOT_ACTIONABLE",
		status: 409,
		message: "This notification can no longer be acted on",
	},
	PushUnavailable: {
		code: "PUSH_UNAVAILABLE",
		status: 422,
		message: "Push notifications are not available",
	},
	InvalidTimezone: {
		code: "INVALID_TIMEZONE",
		status: 422,
		message: "Choose a valid timezone",
	},
	CanvasNotFound: {
		code: "CANVAS_NOT_FOUND",
		status: 404,
		message: "Canvas not found",
	},
	CanvasNotEditable: {
		code: "CANVAS_NOT_EDITABLE",
		status: 422,
		message: "This canvas lives in a page; edit it in the editor",
	},
	ShareNotFound: {
		code: "SHARE_NOT_FOUND",
		status: 404,
		message: "This shared page is no longer available",
	},
	StaleWrite: {
		code: "STALE_WRITE",
		status: 409,
		message: "This document changed since you loaded it",
	},
	PageRevisionConflict: {
		code: "REVISION_CONFLICT",
		status: 409,
		message:
			"The page body changed. Read the page again before retrying this edit.",
	},
	AgentNotFound: {
		code: "AGENT_NOT_FOUND",
		status: 404,
		message: "This agent request is no longer pending",
	},
	McpClientNotFound: {
		code: "MCP_CLIENT_NOT_FOUND",
		status: 404,
		message: "This MCP client is no longer available",
	},
	McpConnectionNotFound: {
		code: "MCP_CONNECTION_NOT_FOUND",
		status: 404,
		message: "This MCP connection is no longer active",
	},
	UserNotFound: {
		code: "USER_NOT_FOUND",
		status: 404,
		message: "No waitlisted user with that id",
	},
});

export const appError = createAppError(errors);

import { createAppError, defineErrors } from "@beignet/core/errors";

export const errors = defineErrors({
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
	CanvasNotFound: {
		code: "CANVAS_NOT_FOUND",
		status: 404,
		message: "Canvas not found",
	},
});

export const appError = createAppError(errors);

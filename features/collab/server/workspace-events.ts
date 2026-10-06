import "@beignet/core/server-only";
import type { AppContext } from "@/app-context";
import {
	workspaceChanges,
	workspaceFavorites,
} from "@/features/collab/channels";
import {
	createWorkspaceCanvasEvent,
	createWorkspacePageEvent,
	createWorkspaceTaskEvent,
	createWorkspaceFavoritesEvent,
	type WorkspaceCanvasEvent,
	type WorkspacePageEvent,
	type WorkspaceTaskEvent,
	type WorkspaceFavoritesEvent,
} from "@/features/collab/workspace-events";

async function publishSafely(
	ctx: AppContext,
	event: WorkspacePageEvent | WorkspaceTaskEvent | WorkspaceCanvasEvent,
) {
	try {
		await ctx.ports.broadcast.publish(workspaceChanges, {
			params: { workspaceId: event.workspaceId },
			event: "changed",
			data: event,
		});
	} catch (error) {
		ctx.ports.logger.warn("Failed to broadcast a workspace event", {
			error,
			type: event.type,
			workspaceId: event.workspaceId,
		});
	}
}

function schedule(ctx: AppContext, event: Parameters<typeof publishSafely>[1]) {
	ctx.ports.bestEffortWork.defer(() => publishSafely(ctx, event));
}

export function scheduleWorkspacePageEvent(
	ctx: AppContext,
	input: Pick<
		WorkspacePageEvent,
		"type" | "workspaceId" | "pageId" | "affectedPageIds"
	>,
) {
	schedule(ctx, createWorkspacePageEvent(input));
}

export function scheduleWorkspaceTaskEvent(
	ctx: AppContext,
	input: Pick<WorkspaceTaskEvent, "workspaceId" | "taskId">,
) {
	schedule(ctx, createWorkspaceTaskEvent(input));
}

export function scheduleWorkspaceCanvasEvent(
	ctx: AppContext,
	input: Pick<WorkspaceCanvasEvent, "workspaceId" | "canvasId" | "pageId">,
) {
	schedule(ctx, createWorkspaceCanvasEvent(input));
}

export function scheduleWorkspaceFavoritesEvent(
	ctx: AppContext,
	input: Pick<
		WorkspaceFavoritesEvent,
		"workspaceId" | "userId" | "resourceType"
	>,
) {
	const event = createWorkspaceFavoritesEvent(input);
	ctx.ports.bestEffortWork.defer(async () => {
		try {
			await ctx.ports.broadcast.publish(workspaceFavorites, {
				params: { workspaceId: event.workspaceId, userId: event.userId },
				event: "changed",
				data: event,
			});
		} catch (error) {
			ctx.ports.logger.warn("Failed to broadcast a favorites event", {
				error,
				workspaceId: event.workspaceId,
			});
		}
	});
}

import "@beignet/core/server-only";
import type { AppContext } from "@/app-context";
import {
	createWorkspaceCanvasEvent,
	createWorkspacePageEvent,
	createWorkspaceTaskEvent,
	type WorkspaceCanvasEvent,
	type WorkspacePageEvent,
	type WorkspaceTaskEvent,
} from "@/features/collab/workspace-events";

async function publishSafely(
	ctx: AppContext,
	event: WorkspacePageEvent | WorkspaceTaskEvent | WorkspaceCanvasEvent,
) {
	try {
		await ctx.ports.workspaceEvents.publish(event);
	} catch (error) {
		ctx.ports.logger.warn("Failed to broadcast a workspace event", {
			error,
			type: event.type,
			workspaceId: event.workspaceId,
		});
	}
}

function schedule(ctx: AppContext, event: Parameters<typeof publishSafely>[1]) {
	try {
		ctx.ports.afterResponse.schedule(() => publishSafely(ctx, event));
	} catch (error) {
		ctx.ports.logger.warn("Failed to schedule a workspace event", {
			error,
			type: event.type,
			workspaceId: event.workspaceId,
		});
	}
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

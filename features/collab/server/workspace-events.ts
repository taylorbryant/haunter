import "@beignet/core/server-only";
import type { AppContext } from "@/app-context";
import {
	createWorkspacePageEvent,
	createWorkspaceTaskEvent,
	type WorkspacePageEvent,
	type WorkspaceTaskEvent,
} from "@/features/collab/workspace-events";

type PageEventInput = Pick<
	WorkspacePageEvent,
	"type" | "workspaceId" | "pageId" | "affectedPageIds"
>;

export async function publishWorkspacePageEvent(
	ctx: AppContext,
	input: PageEventInput,
): Promise<void> {
	const event = createWorkspacePageEvent(input);
	try {
		await ctx.ports.workspaceEvents.publish(event);
	} catch (error) {
		// The database projection is authoritative. A transient event transport
		// failure is repaired by reconnect/focus polling and must never make the
		// committed mutation look unsuccessful to its caller.
		ctx.ports.logger.warn("Failed to broadcast a workspace page event", {
			error,
			type: event.type,
			workspaceId: event.workspaceId,
			pageId: event.pageId,
		});
	}
}

export function scheduleWorkspacePageEvent(
	ctx: AppContext,
	input: PageEventInput,
): void {
	try {
		ctx.ports.afterResponse.schedule(() =>
			publishWorkspacePageEvent(ctx, input),
		);
	} catch (error) {
		ctx.ports.logger.warn("Failed to schedule a workspace page event", {
			error,
			type: input.type,
			workspaceId: input.workspaceId,
			pageId: input.pageId,
		});
	}
}

type TaskEventInput = Pick<WorkspaceTaskEvent, "workspaceId" | "taskId">;

export async function publishWorkspaceTaskEvent(
	ctx: AppContext,
	input: TaskEventInput,
): Promise<void> {
	const event = createWorkspaceTaskEvent(input);
	try {
		await ctx.ports.workspaceEvents.publish(event);
	} catch (error) {
		ctx.ports.logger.warn("Failed to broadcast a workspace task event", {
			error,
			type: event.type,
			workspaceId: event.workspaceId,
			taskId: event.taskId,
		});
	}
}

export function scheduleWorkspaceTaskEvent(
	ctx: AppContext,
	input: TaskEventInput,
): void {
	try {
		ctx.ports.afterResponse.schedule(() =>
			publishWorkspaceTaskEvent(ctx, input),
		);
	} catch (error) {
		ctx.ports.logger.warn("Failed to schedule a workspace task event", {
			error,
			type: "task.changed",
			workspaceId: input.workspaceId,
			taskId: input.taskId,
		});
	}
}

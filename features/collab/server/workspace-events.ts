import "@beignet/core/server-only";
import type { AppContext } from "@/app-context";
import {
	createWorkspacePageEvent,
	type WorkspacePageEvent,
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

import { defineChannel } from "@beignet/core/broadcasting";
import { z } from "zod";
import { CanvasAgentActivitySchema } from "@/features/agents/canvas-activity";
import { WorkspaceEventSchema } from "./schemas";

/** Projection and presence hints; document content uses Yjs and tldraw sync. */
export const workspaceChanges = defineChannel("workspace.changes", {
	params: z.object({ workspaceId: z.string().min(1) }),
	events: { changed: WorkspaceEventSchema },
});

// New clients opt in explicitly. Existing tabs must never receive a new variant
// on workspace.changes: their frozen event schema would block that subscription.
export const workspaceCanvasActivity = defineChannel(
	"workspace.canvas-activity.v1",
	{
		params: z.object({ workspaceId: z.string().min(1) }),
		events: { activity: CanvasAgentActivitySchema },
	},
);

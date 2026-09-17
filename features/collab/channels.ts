import { defineChannel } from "@beignet/core/broadcasting";
import { z } from "zod";
import { WorkspaceEventSchema } from "./schemas";

/** Projection and presence hints; document content uses Yjs and tldraw sync. */
export const workspaceChanges = defineChannel("workspace.changes", {
	params: z.object({ workspaceId: z.string().min(1) }),
	events: { changed: WorkspaceEventSchema },
});

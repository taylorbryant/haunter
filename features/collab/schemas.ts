import { z } from "zod";
import { PageAgentActivitySchema } from "@/features/agents/page-activity";

const WorkspaceEventBase = z.object({
	schemaVersion: z.literal(1),
	workspaceId: z.string().min(1),
	occurredAt: z.string(),
});

export const WorkspacePageEventSchema = WorkspaceEventBase.extend({
	type: z.enum([
		"page.created",
		"page.renamed",
		"page.contentChanged",
		"page.moved",
		"page.iconChanged",
		"page.trashed",
		"page.restored",
		"page.purged",
	]),
	pageId: z.string().min(1),
	affectedPageIds: z.array(z.string().min(1)).min(1).optional(),
});
export const WorkspaceTaskEventSchema = WorkspaceEventBase.extend({
	type: z.literal("task.changed"),
	taskId: z.string().min(1),
});
export const WorkspaceCanvasEventSchema = WorkspaceEventBase.extend({
	type: z.literal("canvas.changed"),
	canvasId: z.string().min(1),
	pageId: z.string().min(1).nullable(),
});
export const WorkspaceEventSchema = z.discriminatedUnion("type", [
	WorkspacePageEventSchema,
	WorkspaceTaskEventSchema,
	WorkspaceCanvasEventSchema,
	PageAgentActivitySchema,
]);

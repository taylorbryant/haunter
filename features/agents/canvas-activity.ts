import { z } from "zod";
import { PageAgentActivitySchema } from "./page-activity";

export const CANVAS_AGENT_ACTIVE_TTL_MS = 60_000;
export const CANVAS_AGENT_RECENT_TTL_MS = 15_000;
export const CANVAS_AGENT_HIGHLIGHT_TTL_MS = 6_000;

export const CanvasAgentActivitySchema = PageAgentActivitySchema.omit({
	pageId: true,
	action: true,
	type: true,
}).extend({
	type: z.literal("agent.canvasActivity"),
	canvasId: z.uuid(),
	pageId: z.uuid().nullable(),
	action: z.enum(["read", "preview", "edit", "delete"]),
	// Only successful edits carry these IDs. No text or drawing payloads travel
	// through the workspace presence channel.
	changedShapeIds: z
		.array(
			z
				.string()
				.regex(/^shape:.+/)
				.max(200),
		)
		.max(100),
});
export type CanvasAgentActivity = z.infer<typeof CanvasAgentActivitySchema>;
export const isCanvasAgentActivity = (
	value: unknown,
): value is CanvasAgentActivity =>
	CanvasAgentActivitySchema.safeParse(value).success;

const labels = {
	read: { active: "Reading canvas", completed: "Read canvas" },
	preview: { active: "Previewing canvas", completed: "Preview ready" },
	edit: { active: "Updating canvas", completed: "Updated canvas" },
	delete: { active: "Removing shapes", completed: "Removed shapes" },
};
export function canvasAgentActivityLabel(activity: CanvasAgentActivity) {
	if (activity.phase === "failed") return "Canvas action failed";
	return labels[activity.action][activity.phase];
}

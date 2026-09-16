import { z } from "zod";

export const PAGE_AGENT_ACTIVE_TTL_MS = 60_000;
export const PAGE_AGENT_RECENT_TTL_MS = 15_000;

export const PageAgentActivitySchema = z.object({
	schemaVersion: z.literal(1),
	type: z.literal("agent.pageActivity"),
	workspaceId: z.string().min(1),
	pageId: z.string().uuid(),
	operationId: z.string().uuid(),
	agentId: z.string().min(1),
	agentName: z.string().min(1).max(100),
	userId: z.string().min(1),
	userName: z.string().min(1).max(100),
	action: z.enum(["read", "append", "update", "archive", "restore"]),
	phase: z.enum(["active", "completed", "failed"]),
	startedAt: z.iso.datetime(),
	occurredAt: z.iso.datetime(),
});

export type PageAgentActivity = z.infer<typeof PageAgentActivitySchema>;

export function isPageAgentActivity(
	value: unknown,
): value is PageAgentActivity {
	return PageAgentActivitySchema.safeParse(value).success;
}

const labels = {
	read: { active: "Reading", completed: "Read just now" },
	append: { active: "Adding content", completed: "Added content just now" },
	update: {
		active: "Updating page details",
		completed: "Updated details just now",
	},
	archive: { active: "Archiving page", completed: "Archived just now" },
	restore: { active: "Restoring page", completed: "Restored just now" },
};

export function pageAgentActivityLabel(activity: PageAgentActivity): string {
	if (activity.phase === "failed") return "Action failed just now";
	return labels[activity.action][activity.phase];
}

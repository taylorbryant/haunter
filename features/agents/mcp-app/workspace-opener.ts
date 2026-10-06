import { z } from "zod";
import { WorkspaceListSchema } from "./schemas";
import { WorkspaceTargetSchema } from "./workspace-bridge";

export const OpenHaunterInputSchema = z
	.object({
		workspaceId: z.string().min(1).max(200).optional(),
		view: z.enum(["home", "tasks"]).optional(),
		taskId: z.uuid().optional(),
		filter: z.enum(["open", "completed", "all"]).optional(),
		scope: z.enum(["mine", "everyone"]).optional(),
	})
	.refine(
		(input) => !input.taskId || !!input.workspaceId,
		"A task requires its workspaceId.",
	)
	.refine(
		(input) =>
			input.view !== "home" || !(input.taskId || input.filter || input.scope),
		"Task filters require the Tasks view.",
	);

export const OpenHaunterOutputSchema = WorkspaceListSchema.extend({
	target: WorkspaceTargetSchema.optional(),
});

import "@beignet/core/server-only";
import { z } from "zod";
import { defineAgentCapability } from "@/lib/agent-capabilities";

export const listWorkspacesCapability = defineAgentCapability(
	"list_workspaces",
	{
		description:
			"List the workspaces the acting user belongs to, with their role in each. Call this first to get workspaceId values for the other capabilities.",
		input: z.object({}),
		output: z.object({
			workspaces: z.array(
				z.object({ id: z.string(), name: z.string(), role: z.string() }),
			),
		}),
		async handle({ ctx, principal }) {
			return {
				workspaces: await ctx.ports.members.listForUser(principal.userId),
			};
		},
	},
);

import "@beignet/core/server-only";
import { z } from "zod";
import { AGENT_CAPABILITY_DESCRIPTIONS } from "@/features/agents/capability-catalog";
import { defineAgentCapability } from "@/lib/agent-capabilities";

export const listWorkspacesCapability = defineAgentCapability(
	"list_workspaces",
	{
		description: AGENT_CAPABILITY_DESCRIPTIONS.list_workspaces,
		input: z.object({}),
		output: z.object({
			workspaces: z.array(
				z.object({ id: z.string(), name: z.string(), role: z.string() }),
			),
		}),
		async handle({ ctx, principal }) {
			const authorizedWorkspaceIds = principal.authorizedWorkspaceIds
				? new Set(principal.authorizedWorkspaceIds)
				: null;
			return {
				workspaces: (
					await ctx.ports.members.listForUser(principal.userId)
				).filter(
					(workspace) =>
						!authorizedWorkspaceIds ||
						authorizedWorkspaceIds.has(workspace.id),
				),
			};
		},
	},
);

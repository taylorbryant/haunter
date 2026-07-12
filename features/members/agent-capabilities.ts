import "@beignet/core/server-only";
import { z } from "zod";
import { defineAgentCapability } from "@/lib/agent-capabilities";

export const listWorkspaceMembersCapability = defineAgentCapability(
	"list_workspace_members",
	{
		description:
			"List the members of one workspace with user ids, names, emails, and roles. Use the returned userId as assigneeId when creating or updating tasks.",
		input: z.object({ workspaceId: z.string().min(1) }),
		output: z.object({
			members: z.array(
				z.object({
					userId: z.string(),
					name: z.string(),
					email: z.string(),
					role: z.string(),
				}),
			),
		}),
		async handle({ ctx, input }) {
			const { listWorkspaceMembersUseCase } = await import(
				"@/features/members/use-cases"
			);
			const result = await listWorkspaceMembersUseCase.run({ ctx, input });
			return { members: result.items };
		},
	},
);

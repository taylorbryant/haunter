import "@beignet/core/server-only";
import { defineAgentCapability } from "@/lib/agent-capabilities";
import { AGENT_CAPABILITY_DESCRIPTIONS } from "@/features/agents/capability-catalog";
import {
	SearchWorkspaceInputSchema,
	SearchWorkspaceOutputSchema,
} from "./schemas";
import { searchWorkspaceUseCase } from "./use-cases";

export const searchWorkspaceCapability = defineAgentCapability(
	"search_workspace",
	{
		description: AGENT_CAPABILITY_DESCRIPTIONS.search_workspace,
		input: SearchWorkspaceInputSchema,
		output: SearchWorkspaceOutputSchema,
		handle: ({ ctx, input }) => searchWorkspaceUseCase.run({ ctx, input }),
	},
);

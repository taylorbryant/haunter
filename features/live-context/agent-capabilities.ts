import "@beignet/core/server-only";
import { AGENT_CAPABILITY_DESCRIPTIONS } from "@/features/agents/capability-catalog";
import { defineAgentCapability } from "@/lib/agent-capabilities";
import {
	GetActiveContextInputSchema,
	GetActiveContextOutputSchema,
	ListActiveSessionsOutputSchema,
	WorkspaceContextInputSchema,
} from "./schemas";
import {
	getActiveContextUseCase,
	listActiveSessionsUseCase,
} from "./use-cases";

export const liveContextAgentCapabilities = [
	defineAgentCapability("list_active_sessions", {
		description: AGENT_CAPABILITY_DESCRIPTIONS.list_active_sessions,
		input: WorkspaceContextInputSchema,
		output: ListActiveSessionsOutputSchema,
		handle: ({ ctx, input }) => listActiveSessionsUseCase.run({ ctx, input }),
	}),
	defineAgentCapability("get_active_context", {
		description: AGENT_CAPABILITY_DESCRIPTIONS.get_active_context,
		input: GetActiveContextInputSchema,
		output: GetActiveContextOutputSchema,
		handle: ({ ctx, input }) => getActiveContextUseCase.run({ ctx, input }),
	}),
] as const;

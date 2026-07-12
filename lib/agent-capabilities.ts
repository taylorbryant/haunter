import "@beignet/core/server-only";
import { createAgentCapabilities } from "@beignet/core/agent-capabilities";
import type { AppContext } from "@/app-context";

export type AgentPrincipal = {
	agentId: string;
	userId: string;
};

export const { defineAgentCapability, defineAgentCapabilityRegistry } =
	createAgentCapabilities<AppContext, AgentPrincipal>();

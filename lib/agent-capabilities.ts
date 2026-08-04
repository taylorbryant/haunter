import "@beignet/core/server-only";
import { createAgentCapabilities } from "@beignet/core/agent-capabilities";
import type { AppContext } from "@/app-context";

export type AgentPrincipal = {
	agentId: string;
	userId: string;
	presenceId: string;
	displayName?: string;
	transport?: "agent-auth" | "remote-mcp";
	remoteConnectionId?: string;
	remoteClientId?: string;
	authorizedWorkspaceIds?: readonly string[];
};

export const { defineAgentCapability, defineAgentCapabilityRegistry } =
	createAgentCapabilities<AppContext, AgentPrincipal>();

import "@beignet/core/server-only";
import { createAgentCapabilities } from "@beignet/core/agent-capabilities";
import type { AppContext } from "@/app-context";

export type AgentPrincipal = {
	agentId: string;
	userId: string;
	transport?: "agent-auth" | "remote-mcp";
	remoteConnectionId?: string;
	remoteClientId?: string;
	remoteClientName?: string | null;
	/** Current capability grants loaded by the authenticated MCP transport. */
	remoteCapabilities?: readonly string[];
	authorizedWorkspaceIds?: readonly string[];
	/** Derived only by a verified transport from current scoped grants. */
	pageBlockDeletionAllowed?: boolean;
};

export const { defineAgentCapability, defineAgentCapabilityRegistry } =
	createAgentCapabilities<AppContext, AgentPrincipal>();

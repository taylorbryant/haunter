import "@beignet/core/server-only";
import { listWorkspaceMembersCapability } from "@/features/members/agent-capabilities";
import { pageAgentCapabilities } from "@/features/pages/agent-capabilities";
import {
	createTaskAgentCapabilities,
	type TaskAgentCapabilityDependencies,
} from "@/features/tasks/agent-capabilities";
import { listWorkspacesCapability } from "@/features/workspaces/agent-capabilities";
import { defineAgentCapabilityRegistry } from "@/lib/agent-capabilities";

export function createHaunterAgentCapabilityRegistry(
	dependencies: TaskAgentCapabilityDependencies = {},
) {
	return defineAgentCapabilityRegistry([
		listWorkspacesCapability,
		listWorkspaceMembersCapability,
		...pageAgentCapabilities,
		...createTaskAgentCapabilities(dependencies),
	] as const);
}

export const agentCapabilityRegistry = createHaunterAgentCapabilityRegistry();
export const agentCapabilities = agentCapabilityRegistry.definitions;

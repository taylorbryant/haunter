import "@beignet/core/server-only";
import { canvasAgentCapabilities } from "@/features/canvases/agent-capabilities";
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
		...canvasAgentCapabilities,
		...createTaskAgentCapabilities(dependencies),
	] as const);
}

export const agentCapabilityRegistry = createHaunterAgentCapabilityRegistry();
export const agentCapabilities = agentCapabilityRegistry.definitions;

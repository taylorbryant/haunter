import "@beignet/core/server-only";
import {
	createBetterAuthAgentCapabilityAdapter,
	type BetterAuthAgentCapabilityMetadata,
} from "@beignet/agent-auth-better-auth";
import type { AgentCapabilityExecutor } from "@beignet/core/agent-capabilities";
import { APIError } from "better-auth/api";
import type { AgentPrincipal } from "@/lib/agent-capabilities";
import { agentCapabilityRegistry } from "@/lib/agent-capability-registry";

export type HaunterAgentCapabilityExecutor = AgentCapabilityExecutor<
	AgentPrincipal,
	typeof agentCapabilityRegistry.definitions
>;

type AgentCapabilityName =
	(typeof agentCapabilityRegistry.definitions)[number]["name"];
type WorkspaceScopedCapabilityName = Exclude<
	AgentCapabilityName,
	"list_workspaces"
>;

const workspaceScope = {
	requiredConstraints: ["workspaceId"],
} satisfies BetterAuthAgentCapabilityMetadata;

/**
 * Every capability except workspace discovery is intentionally scoped to one
 * of the acting user's workspaces. The exhaustive record makes new capability
 * definitions choose a grant scope before they can compile.
 */
export const agentCapabilityMetadata = {
	list_workspace_members: workspaceScope,
	list_pages: workspaceScope,
	search_pages: workspaceScope,
	read_page: workspaceScope,
	create_page: workspaceScope,
	append_to_page: workspaceScope,
	update_page: workspaceScope,
	archive_page: workspaceScope,
	restore_page: workspaceScope,
	list_tasks: workspaceScope,
	create_task: workspaceScope,
	update_task: workspaceScope,
	complete_task: workspaceScope,
	reopen_task: workspaceScope,
	delete_task: workspaceScope,
} satisfies Record<
	WorkspaceScopedCapabilityName,
	BetterAuthAgentCapabilityMetadata
>;

export function createHaunterAgentAuthAdapter(
	executor: HaunterAgentCapabilityExecutor,
) {
	return createBetterAuthAgentCapabilityAdapter({
		registry: agentCapabilityRegistry,
		executor,
		metadata: agentCapabilityMetadata,
		principal({ agentSession }) {
			if (!agentSession.userId) {
				throw new APIError("FORBIDDEN", {
					message:
						"This capability requires a delegated agent acting for a user.",
				});
			}
			return {
				agentId: agentSession.agentId,
				userId: agentSession.userId,
			};
		},
	});
}

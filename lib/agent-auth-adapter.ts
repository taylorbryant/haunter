import "@beignet/core/server-only";
import {
	createBetterAuthAgentCapabilityAdapter,
	type BetterAuthAgentCapabilityMetadata,
	type CreateBetterAuthAgentCapabilityAdapterOptions,
} from "@beignet/agent-auth-better-auth";
import type { AgentCapabilityExecutor } from "@beignet/core/agent-capabilities";
import { APIError } from "better-auth/api";
import type { AgentPrincipal } from "@/lib/agent-capabilities";
import { agentCapabilityRegistry } from "@/lib/agent-capability-registry";

export type HaunterAgentCapabilityExecutor = AgentCapabilityExecutor<
	AgentPrincipal,
	typeof agentCapabilityRegistry.definitions
>;

type HaunterAgentCapabilityExecutorSource =
	CreateBetterAuthAgentCapabilityAdapterOptions<
		typeof agentCapabilityRegistry.definitions
	>["executor"];

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
	list_active_sessions: workspaceScope,
	get_active_context: workspaceScope,
	create_canvas_block: workspaceScope,
	read_canvas: workspaceScope,
	preview_canvas: workspaceScope,
	edit_canvas: workspaceScope,
	delete_canvas_shapes: workspaceScope,
	list_workspace_members: workspaceScope,
	list_pages: workspaceScope,
	search_pages: workspaceScope,
	read_page: workspaceScope,
	create_page: workspaceScope,
	append_to_page: workspaceScope,
	edit_page_blocks: workspaceScope,
	replace_page_content: workspaceScope,
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
	executor: HaunterAgentCapabilityExecutorSource,
) {
	return createBetterAuthAgentCapabilityAdapter({
		registry: agentCapabilityRegistry,
		executor,
		metadata: agentCapabilityMetadata,
		principal({ agentSession, arguments: args }) {
			if (!agentSession.userId) {
				throw new APIError("FORBIDDEN", {
					message:
						"This capability requires a delegated agent acting for a user.",
				});
			}
			return {
				agentId: agentSession.agentId,
				userId: agentSession.userId,
				pageBlockDeletionAllowed: agentSession.agent.capabilityGrants.some(
					(grant) =>
						grant.capability === "replace_page_content" &&
						grant.status === "active" &&
						// Better Auth's verified session contains only unexpired effective grants.
						allowsBlockDeletionScope(grant.constraints, args ?? {}),
				),
			};
		},
	});
}

/** A replacement grant permits deletion only within its explicit resource scope.
 * Additional constraints that cannot be evaluated for a block edit fail closed. */
function allowsBlockDeletionScope(
	constraints: Record<string, unknown> | null,
	args: Record<string, unknown>,
) {
	if (!constraints || !Object.hasOwn(constraints, "workspaceId")) return false;
	return Object.entries(constraints).every(([key, rule]) => {
		if (key !== "workspaceId" && key !== "pageId") return false;
		const value = args[key];
		if (typeof value !== "string") return false;
		if (typeof rule === "string") return value === rule;
		if (!rule || typeof rule !== "object" || Array.isArray(rule)) return false;
		const operators = Object.entries(rule);
		return (
			operators.length > 0 &&
			operators.every(([operator, operand]) => {
				if (operator === "eq") return value === operand;
				if (operator === "in")
					return Array.isArray(operand) && operand.includes(value);
				if (operator === "not_in")
					return Array.isArray(operand) && !operand.includes(value);
				return false;
			})
		);
	});
}

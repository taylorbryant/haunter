import "@beignet/core/server-only";
import {
	PendingAgentInputSchema,
	PendingAgentSchema,
} from "@/features/agents/schemas";
import { grantWorkspaceScopeLabel } from "@/features/agents/grant-scope";
import { appError } from "@/features/shared/errors";
import { agentCapabilities } from "@/lib/agent-capability-registry";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";

/**
 * An agent approval request for the device-approval page. Initial registrations
 * have no owner yet, so any signed-in user holding the verification link may
 * review them. Additional capability requests belong to an active agent and
 * are only visible to that agent's owner. Approval itself still requires the
 * user code and is enforced by the agent-auth plugin.
 */
export const getPendingAgentUseCase = useCase
	.query("agents.getPending")
	.input(PendingAgentInputSchema)
	.output(PendingAgentSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		const row = await ctx.ports.agents.findAwaitingApprovalById(input.agentId);
		if (!row || (row.userId !== null && row.userId !== user.id)) {
			throw appError("AgentNotFound");
		}
		const approvalId = await ctx.ports.agents.findCurrentApprovalIdByAgentId(
			input.agentId,
			new Date(),
		);
		if (!approvalId) {
			throw appError("AgentNotFound");
		}

		const requested = row.grants.filter((grant) => grant.status === "pending");
		const workspaces = await ctx.ports.members.listForUser(user.id);
		const workspaceNames = new Map(
			workspaces.map((workspace) => [workspace.id, workspace.name]),
		);

		return {
			id: row.id,
			approvalId,
			name: row.name,
			hostName: row.hostName,
			requestedCapabilities: requested.map((grant) => ({
				name: grant.capability,
				description:
					agentCapabilities.find((c) => c.name === grant.capability)
						?.description ?? "",
				workspaceScope: grantWorkspaceScopeLabel(grant, workspaceNames),
			})),
			createdAt: row.createdAt.toISOString(),
		};
	});

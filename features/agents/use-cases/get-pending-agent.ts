import "@beignet/core/server-only";
import {
	PendingAgentInputSchema,
	PendingAgentSchema,
} from "@/features/agents/schemas";
import { appError } from "@/features/shared/errors";
import { agentCapabilities } from "@/lib/agent-capabilities";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";

/**
 * A pending agent's approval details for the device-approval page. Any
 * signed-in user holding the verification link may view the request (the
 * agent has no owner yet — whoever approves becomes its user), but approval
 * itself requires the user code and is enforced by the agent-auth plugin.
 */
export const getPendingAgentUseCase = useCase
	.query("agents.getPending")
	.input(PendingAgentInputSchema)
	.output(PendingAgentSchema)
	.run(async ({ ctx, input }) => {
		requireUser(ctx);
		const row = await ctx.ports.agents.findPendingById(input.agentId);
		if (!row) {
			throw appError("AgentNotFound");
		}

		const requested = row.grants.filter((grant) => grant.status === "pending");

		return {
			id: row.id,
			name: row.name,
			hostName: row.hostName,
			requestedCapabilities: requested.map((grant) => ({
				name: grant.capability,
				description:
					agentCapabilities.find((c) => c.name === grant.capability)
						?.description ?? "",
			})),
			createdAt: row.createdAt.toISOString(),
		};
	});

import "@beignet/core/server-only";
import {
	ListAgentActivityInputSchema,
	ListAgentActivityOutputSchema,
} from "@/features/agents/schemas";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";

export const listAgentActivityUseCase = useCase
	.query("agents.listActivity")
	.input(ListAgentActivityInputSchema)
	.output(ListAgentActivityOutputSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		const rows = await ctx.ports.agents.listRecentActivityByUser(
			user.id,
			input.limit,
		);

		return {
			items: rows.map((row) => ({
				id: row.id,
				agentId: row.agentId,
				agentName: row.agentName,
				workspaceId: row.workspaceId,
				capability: row.capability,
				status: row.status,
				resourceType: row.resourceType,
				resourceId: row.resourceId,
				resourceLabel: row.resourceLabel,
				durationMs: row.durationMs,
				error: row.error,
				createdAt: row.createdAt.toISOString(),
			})),
		};
	});

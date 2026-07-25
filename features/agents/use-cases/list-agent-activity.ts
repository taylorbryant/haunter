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
		const [agentRows, mcpRows] = await Promise.all([
			ctx.ports.agents.listRecentActivityByUser(user.id, input.limit),
			ctx.ports.mcpConnections.listRecentActivityByUser(user.id, input.limit),
		]);

		return {
			items: [
				...agentRows.map((row) => ({
					id: row.id,
					source: "agent-auth" as const,
					agentId: row.agentId,
					connectionId: null,
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
				...mcpRows.map((row) => ({
					id: row.id,
					source: "remote-mcp" as const,
					agentId: null,
					connectionId: row.connectionId,
					agentName: row.clientName ?? "MCP client",
					workspaceId: row.workspaceId,
					capability: row.capability,
					status: row.status,
					resourceType: row.resourceType,
					resourceId: row.resourceId,
					resourceLabel: row.resourceLabel,
					durationMs: row.durationMs,
					error: row.errorCode,
					createdAt: row.createdAt.toISOString(),
				})),
			]
				.sort(
					(a, b) =>
						new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
				)
				.slice(0, input.limit),
		};
	});

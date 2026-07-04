import "@beignet/core/server-only";
import { z } from "zod";
import type { AgentAdminRow } from "@/features/agents/ports";
import { ListAgentsOutputSchema } from "@/features/agents/schemas";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";

export function toAgentSummary(row: AgentAdminRow) {
	return {
		id: row.id,
		name: row.name,
		mode: row.mode,
		status: row.status,
		hostName: row.hostName,
		grants: row.grants,
		lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
		createdAt: row.createdAt.toISOString(),
	};
}

/**
 * The caller's agents. Agents are user-scoped, not workspace-scoped: a
 * delegated agent acts for its user across every workspace that user can
 * reach, so the list lives with the account, not the tenant.
 */
export const listAgentsUseCase = useCase
	.query("agents.list")
	.input(z.object({}))
	.output(ListAgentsOutputSchema)
	.run(async ({ ctx }) => {
		const user = requireUser(ctx);
		const rows = await ctx.ports.agents.listByUser(user.id);

		return { items: rows.map(toAgentSummary) };
	});

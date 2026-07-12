import "@beignet/core/server-only";
import { z } from "zod";
import { grantWorkspaceScopeLabel } from "@/features/agents/grant-scope";
import type { AgentAdminRow } from "@/features/agents/ports";
import { ListAgentsOutputSchema } from "@/features/agents/schemas";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";

export function toAgentSummary(
	row: AgentAdminRow,
	workspaceNames: ReadonlyMap<string, string> = new Map(),
) {
	return {
		id: row.id,
		name: row.name,
		mode: row.mode,
		status: row.status,
		hostName: row.hostName,
		grants: row.grants.map((grant) => ({
			capability: grant.capability,
			status: grant.status,
			workspaceScope: grantWorkspaceScopeLabel(grant, workspaceNames),
		})),
		lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
		createdAt: row.createdAt.toISOString(),
	};
}

/**
 * The caller's agents. Agents are user-scoped, not workspace-scoped: a
 * delegated agent belongs to the user while individual grants may be scoped
 * to one workspace, so the list lives with the account, not the tenant.
 */
export const listAgentsUseCase = useCase
	.query("agents.list")
	.input(z.object({}))
	.output(ListAgentsOutputSchema)
	.run(async ({ ctx }) => {
		const user = requireUser(ctx);
		const [rows, workspaces] = await Promise.all([
			ctx.ports.agents.listByUser(user.id),
			ctx.ports.members.listForUser(user.id),
		]);
		const workspaceNames = new Map(
			workspaces.map((workspace) => [workspace.id, workspace.name]),
		);

		return { items: rows.map((row) => toAgentSummary(row, workspaceNames)) };
	});

import "@beignet/core/server-only";
import {
	AuthorizeMcpConnectionInputSchema,
	McpConnectionSummarySchema,
} from "@/features/agents/schemas";
import { appError } from "@/features/shared/errors";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";

export const authorizeMcpConnectionUseCase = useCase
	.command("agents.authorizeMcpConnection")
	.input(AuthorizeMcpConnectionInputSchema)
	.output(McpConnectionSummarySchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		const oauthRequest = await ctx.ports.mcpOAuthRequests.verify(
			input.oauthQuery,
		);
		if (!oauthRequest) throw appError("McpClientNotFound");
		const oauthClient =
			await ctx.ports.mcpOAuthClients.findForConsent(oauthRequest);
		if (!oauthClient) throw appError("McpClientNotFound");
		const memberships = await ctx.ports.members.listForUser(user.id);
		const workspaceNames = new Map(
			memberships.map((workspace) => [workspace.id, workspace.name]),
		);
		if (
			input.workspaceIds.some((workspaceId) => !workspaceNames.has(workspaceId))
		) {
			throw appError("Forbidden", {
				message: "You can only connect workspaces you currently belong to.",
			});
		}

		const now = new Date();
		const connection = await ctx.ports.uow.transaction(async (ports) => {
			return ports.mcpConnections.authorize({
				id: crypto.randomUUID(),
				userId: user.id,
				clientId: oauthRequest.clientId,
				permissionProfile: input.permissionProfile,
				workspaceIds: input.workspaceIds,
				now,
			});
		});
		if (!connection) throw appError("McpClientNotFound");

		return {
			id: connection.id,
			clientId: connection.clientId,
			clientName: connection.clientName,
			permissionProfile: connection.permissionProfile,
			workspaces: connection.workspaceIds.map((id) => ({
				id,
				name: workspaceNames.get(id) ?? "Unavailable workspace",
			})),
			lastUsedAt: connection.lastUsedAt?.toISOString() ?? null,
			createdAt: connection.createdAt.toISOString(),
		};
	});

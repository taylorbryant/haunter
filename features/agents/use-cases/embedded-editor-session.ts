import { useCase } from "@/lib/use-case";
import { appError } from "@/features/shared/errors";
import {
	EmbeddedEditorExchangeSchema,
	EmbeddedEditorIdentitySchema,
} from "../embedded-editor-session";
import { z } from "zod";
export const exchangeEmbeddedEditorUseCase = useCase
	.command("agents.exchangeEmbeddedEditor")
	.input(EmbeddedEditorExchangeSchema)
	.output(
		z.object({ token: z.string(), identity: EmbeddedEditorIdentitySchema }),
	)
	.run(async ({ ctx, input }) => {
		const result = await ctx.ports.embeddedEditorSessions.exchange(input);
		if (!result) throw appError("Unauthorized");
		return result;
	});
export const verifyEmbeddedEditorUseCase = useCase
	.query("agents.verifyEmbeddedEditor")
	.input(z.object({}))
	.output(EmbeddedEditorIdentitySchema)
	.run(async ({ ctx }) => {
		if (!ctx.embeddedEditor) throw appError("Unauthorized");
		return ctx.embeddedEditor;
	});

export const listEmbeddedWorkspacesUseCase = useCase
	.query("agents.listEmbeddedWorkspaces")
	.input(z.object({}))
	.output(
		z.object({
			workspaces: z.array(z.object({ id: z.string(), name: z.string() })),
		}),
	)
	.run(async ({ ctx }) => {
		const identity = ctx.embeddedEditor;
		if (!identity || identity.scope !== "workspace")
			throw appError("Forbidden");
		const connections = await ctx.ports.mcpConnections.listByUser(
			identity.user.id,
		);
		const current = connections.find(
			(connection) => connection.id === identity.connectionId,
		);
		const active =
			current &&
			(await ctx.ports.mcpConnections.findActive(
				identity.user.id,
				current.clientId,
			));
		if (!active) throw appError("Forbidden");
		const memberships = await ctx.ports.members.listForUser(identity.user.id);
		return {
			workspaces: memberships
				.filter((workspace) => active.workspaceIds.includes(workspace.id))
				.map(({ id, name }) => ({ id, name })),
		};
	});

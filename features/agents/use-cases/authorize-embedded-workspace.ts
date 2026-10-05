import { z } from "zod";
import { EmbeddedWorkspaceAuthorizationSchema } from "../embedded-editor-session";
import { appError } from "@/features/shared/errors";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { canEditContent } from "@/lib/org-roles";

/** Only the authenticated MCP transport supplies the client identity. */
export const authorizeEmbeddedWorkspaceUseCase = useCase
	.command("agents.authorizeEmbeddedWorkspace")
	.input(
		EmbeddedWorkspaceAuthorizationSchema.extend({
			clientId: z.string().min(1),
		}),
	)
	.output(z.object({ id: z.uuid() }))
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		const connection = await ctx.ports.mcpConnections.findActive(
			user.id,
			input.clientId,
		);
		const role = await ctx.ports.members.findRole(input.workspaceId, user.id);
		if (
			!connection ||
			!connection.workspaceIds.includes(input.workspaceId) ||
			!role
		)
			throw appError("Forbidden");
		return ctx.ports.embeddedEditorSessions.create({
			scope: "workspace",
			connectionId: connection.id,
			userId: user.id,
			workspaceId: input.workspaceId,
			challenge: input.challenge,
			writable:
				connection.embeddedEditorAccess === "edit" &&
				connection.permissionProfile !== "view" &&
				canEditContent(role),
		});
	});

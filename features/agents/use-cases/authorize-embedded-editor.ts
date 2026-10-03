import { createTenantScope } from "@beignet/core/ports";
import { z } from "zod";
import { EmbeddedEditorAuthorizationSchema } from "../embedded-editor-session";
import { appError } from "@/features/shared/errors";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { canEditContent } from "@/lib/org-roles";

// clientId is injected by the authenticated MCP transport, never a tool argument.
export const authorizeEmbeddedEditorUseCase = useCase
	.command("agents.authorizeEmbeddedEditor")
	.input(
		EmbeddedEditorAuthorizationSchema.extend({ clientId: z.string().min(1) }),
	)
	.output(z.object({ id: z.uuid() }))
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		const connection = await ctx.ports.mcpConnections.findActive(
			user.id,
			input.clientId,
		);
		if (!connection || !connection.workspaceIds.includes(input.workspaceId))
			throw appError("Forbidden");
		const role = await ctx.ports.members.findRole(input.workspaceId, user.id);
		if (!role) throw appError("Forbidden");
		const page = await ctx.ports.pages.findMetaById(
			createTenantScope({ id: input.workspaceId }),
			input.pageId,
		);
		if (!page || page.deletedAt !== null) throw appError("Forbidden");
		await ctx.gate.authorize("pages.read", page);
		return ctx.ports.embeddedEditorSessions.create({
			connectionId: connection.id,
			userId: user.id,
			workspaceId: input.workspaceId,
			pageId: input.pageId,
			challenge: input.challenge,
			writable:
				connection.embeddedEditorAccess === "edit" &&
				connection.permissionProfile !== "view" &&
				canEditContent(role),
		});
	});

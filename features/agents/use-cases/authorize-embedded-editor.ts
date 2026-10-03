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
		EmbeddedEditorAuthorizationSchema.safeExtend({
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
		if (!connection || !connection.workspaceIds.includes(input.workspaceId))
			throw appError("Forbidden");
		const role = await ctx.ports.members.findRole(input.workspaceId, user.id);
		if (!role) throw appError("Forbidden");
		const scope = createTenantScope({ id: input.workspaceId });
		if (input.canvasId) {
			const canvas = await ctx.ports.canvases.findById(scope, input.canvasId);
			if (!canvas) throw appError("Forbidden");
			await ctx.gate.authorize("canvases.read", canvas);
			if (canvas.pageId) {
				const parent = await ctx.ports.pages.findMetaById(scope, canvas.pageId);
				if (!parent || parent.deletedAt !== null) throw appError("Forbidden");
				await ctx.gate.authorize("pages.read", parent);
			}
		} else {
			const page = await ctx.ports.pages.findMetaById(scope, input.pageId!);
			if (!page || page.deletedAt !== null) throw appError("Forbidden");
			await ctx.gate.authorize("pages.read", page);
		}
		return ctx.ports.embeddedEditorSessions.create({
			connectionId: connection.id,
			userId: user.id,
			workspaceId: input.workspaceId,
			pageId: input.pageId,
			canvasId: input.canvasId,
			challenge: input.challenge,
			writable:
				connection.embeddedEditorAccess === "edit" &&
				connection.permissionProfile !== "view" &&
				canEditContent(role),
		});
	});

import { z } from "zod";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";

export const openCanvasSessionUseCase = useCase
	.command("documents.openCanvasSession")
	.input(z.object({ id: z.uuid() }))
	.output(z.object({ token: z.string(), generation: z.number() }))
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		const scope = requireActiveWorkspaceScope(ctx);
		const canvas = await ctx.ports.canvases.findById(scope, input.id);
		if (!canvas) throw appError("CanvasNotFound");
		await ctx.gate.authorize("canvases.read", canvas);
		if (canvas.pageId) {
			const page = await ctx.ports.pages.findMetaById(scope, canvas.pageId);
			if (!page || page.deletedAt !== null) throw appError("CanvasNotFound");
		}
		const sessionId = ctx.auth?.session?.id;
		if (!sessionId) throw appError("Unauthorized");
		if (!(await ctx.ports.canvases.findSyncRoom(scope, canvas.id)))
			throw appError("InvalidPageContent", {
				message: "This canvas has not been migrated.",
			});
		return {
			...ctx.ports.documentSessions.issue({
				kind: "canvas",
				userId: user.id,
				sessionId,
				workspaceId: canvas.workspaceId,
				pageId: canvas.id,
				generation: 0,
			}),
			generation: 0,
		};
	});

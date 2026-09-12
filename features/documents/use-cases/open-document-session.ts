import { z } from "zod";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";

export const openDocumentSessionUseCase = useCase
	.command("documents.openSession")
	.input(z.object({ id: z.uuid() }))
	.output(
		z.object({ token: z.string(), generation: z.number().int().nonnegative() }),
	)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		const scope = requireActiveWorkspaceScope(ctx);
		const page = await ctx.ports.pages.findMetaById(scope, input.id);
		if (!page || page.deletedAt !== null) throw appError("PageNotFound");
		await ctx.gate.authorize("pages.read", page);
		const sessionId = ctx.auth?.session?.id;
		if (!sessionId) throw appError("Unauthorized");
		const generation = await ctx.ports.documents.getGeneration(scope, page.id);
		if (generation === null)
			throw appError("InvalidPageContent", {
				message:
					"This page has not been migrated. Contact the workspace administrator.",
			});
		return {
			...ctx.ports.documentSessions.issue({
				userId: user.id,
				sessionId,
				workspaceId: page.workspaceId,
				pageId: page.id,
				generation,
			}),
			generation,
		};
	});

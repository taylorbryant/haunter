import "@beignet/core/server-only";
import { enqueueJob } from "@beignet/core/outbox";
import { EnsureDocumentJob } from "@/features/documents/jobs";
import { ensureCollaborativeDocument } from "@/features/documents/service";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { CanvasSchema, CreateCanvasInputSchema } from "../schemas";

export const createCanvasUseCase = useCase
	.command("canvases.create")
	.input(CreateCanvasInputSchema)
	.output(CanvasSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		await ctx.gate.authorize("canvases.create");
		const scope = requireActiveWorkspaceScope(ctx, input.workspaceId);

		const canvas = await ctx.ports.uow.transaction(async (tx) => {
			const page = await tx.pages.findMetaById(scope, input.pageId);
			if (!page || page.deletedAt !== null) {
				throw appError("PageNotFound", { details: { id: input.pageId } });
			}

			// The canvas belongs to the page's owner; creating one is a page edit.
			await ctx.gate.authorize("pages.update", page);

			const created = await tx.canvases.create(scope, {
				userId: user.id,
				pageId: input.pageId,
			});
			await enqueueJob(tx.outbox, EnsureDocumentJob, {
				kind: "canvas",
				entityId: created.id,
				workspaceId: created.workspaceId,
			});
			return created;
		});
		try {
			await ensureCollaborativeDocument({
				scope,
				kind: "canvas",
				entityId: canvas.id,
				ports: ctx.ports,
			});
		} catch (error) {
			ctx.ports.logger.warn(
				"Canvas created; durable document seeding will retry",
				{
					canvasId: canvas.id,
					error,
				},
			);
		}
		return canvas;
	});

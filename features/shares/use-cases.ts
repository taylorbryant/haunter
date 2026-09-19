import "@beignet/core/server-only";
import { createTenant, createTenantScope } from "@beignet/core/ports";
import { z } from "zod";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { rewriteFileUrls } from "./lib/rewrite-file-urls";
import { stripPrivateTaskProps } from "./lib/strip-private-task-props";
import {
	GetPageShareOutputSchema,
	PageIdInputSchema,
	PageShareSchema,
	SharedCanvasInputSchema,
	SharedCanvasSchema,
	SharedPageSchema,
	SharedTokenInputSchema,
} from "./schemas";

export const getPageShareUseCase = useCase
	.query("shares.get")
	.input(PageIdInputSchema)
	.output(GetPageShareOutputSchema)
	.run(async ({ ctx, input }) => {
		const scope = requireActiveWorkspaceScope(ctx);

		const page = await ctx.ports.pages.findMetaById(scope, input.pageId);
		if (!page || page.deletedAt !== null) {
			throw appError("PageNotFound", { details: { id: input.pageId } });
		}

		await ctx.gate.authorize("pages.read", page);

		const share = await ctx.ports.shares.findByPage(scope, input.pageId);
		return { share };
	});

/** A share token is a bearer capability; make it unguessable. */
function generateToken(): string {
	return crypto.randomUUID().replaceAll("-", "");
}

/**
 * Publish a page to the web. Idempotent — sharing an already-shared page
 * returns the existing link so the URL stays stable.
 */
export const createPageShareUseCase = useCase
	.command("shares.create")
	.input(PageIdInputSchema)
	.output(PageShareSchema)
	.run(async ({ ctx, input }) => {
		const user = requireUser(ctx);
		const scope = requireActiveWorkspaceScope(ctx);

		return ctx.ports.uow.transaction(async (tx) => {
			const page = await tx.pages.findMetaById(scope, input.pageId);
			if (!page || page.deletedAt !== null) {
				throw appError("PageNotFound", { details: { id: input.pageId } });
			}

			// Publishing a page is an editor-level action on that page.
			await ctx.gate.authorize("pages.update", page);

			const existing = await tx.shares.findByPage(scope, input.pageId);
			if (existing) return existing;

			return tx.shares.create(scope, {
				pageId: page.id,
				token: generateToken(),
				createdBy: user.id,
			});
		});
	});

export const revokePageShareUseCase = useCase
	.command("shares.revoke")
	.input(PageIdInputSchema)
	.output(z.void())
	.run(async ({ ctx, input }) => {
		const scope = requireActiveWorkspaceScope(ctx);

		await ctx.ports.uow.transaction(async (tx) => {
			const page = await tx.pages.findMetaById(scope, input.pageId);
			if (!page) {
				throw appError("PageNotFound", { details: { id: input.pageId } });
			}

			await ctx.gate.authorize("pages.update", page);

			await tx.shares.deleteByPage(scope, input.pageId);
		});
	});

/**
 * Public read of a shared page. The token is the whole authorization — no
 * session, tenant, or membership is consulted, so this must never return
 * anything beyond the shared page's own content. A revoked link (deleted
 * row) and a trashed page both read as the same uniform 404.
 */
export const getSharedPageUseCase = useCase
	.query("shares.getShared")
	.input(SharedTokenInputSchema)
	.output(SharedPageSchema)
	.run(async ({ ctx, input }) => {
		const share = await ctx.ports.shares.findByToken(input.token);
		if (!share) {
			throw appError("ShareNotFound");
		}

		// The persisted capability, not request input, establishes this scope.
		const scope = createTenantScope(createTenant(share.workspaceId));
		const page = await ctx.ports.pages.findById(scope, share.pageId);
		if (!page || page.deletedAt !== null) {
			throw appError("ShareNotFound");
		}

		return {
			title: page.title,
			icon: page.icon,
			// Point embedded files at the share-scoped read route so anonymous
			// visitors can load them.
			content: rewriteFileUrls(
				stripPrivateTaskProps(page.content),
				input.token,
			),
			updatedAt: page.updatedAt,
		};
	});

/**
 * Public read of a canvas embedded in a shared page. The share token is the
 * authorization, and it only reaches canvases that live on the shared page
 * itself — a token never unlocks the rest of the workspace.
 */
export const getSharedCanvasUseCase = useCase
	.query("shares.getSharedCanvas")
	.input(SharedCanvasInputSchema)
	.output(SharedCanvasSchema)
	.run(async ({ ctx, input }) => {
		const share = await ctx.ports.shares.findByToken(input.token);
		if (!share) {
			throw appError("ShareNotFound");
		}

		// The persisted capability, not request input, establishes this scope.
		const scope = createTenantScope(createTenant(share.workspaceId));
		// Both lookups depend only on the share row, so run them together.
		const [page, canvas] = await Promise.all([
			ctx.ports.pages.findMetaById(scope, share.pageId),
			ctx.ports.canvases.findById(scope, input.id),
		]);
		if (!page || page.deletedAt !== null) {
			throw appError("ShareNotFound");
		}

		if (!canvas || canvas.pageId !== share.pageId) {
			throw appError("ShareNotFound");
		}

		return { snapshot: canvas.snapshot };
	});

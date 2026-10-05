import { z } from "zod";
import type { AppContext } from "@/app-context";
import { useCase } from "@/lib/use-case";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { canEditContent } from "@/lib/org-roles";
import { appError } from "@/features/shared/errors";
import {
	createPageUseCase,
	updatePageUseCase,
	deletePageUseCase,
	restorePageUseCase,
	listPagesUseCase,
	getPageNavigationUseCase,
	setPageFavoriteUseCase,
} from "@/features/pages/use-cases";
import { createCanvasUseCase } from "@/features/canvases/use-cases/create-canvas";
import { listCanvasesUseCase } from "@/features/canvases/use-cases/list-canvases";
import { getCanvasNavigationUseCase } from "@/features/canvases/use-cases/get-canvas-navigation";
import { setCanvasFavoriteUseCase } from "@/features/canvases/use-cases/set-canvas-favorite";
import {
	EmbeddedWorkspaceInputSchema,
	EmbeddedWorkspaceActionSchema,
	EmbeddedWorkspaceSchema,
	WorkspaceActionResultSchema,
} from "../mcp-app/workspace-schema";

const identity = { clientId: z.string().min(1) };
async function access(
	ctx: AppContext,
	input: { workspaceId: string; clientId: string },
) {
	const user = requireUser(ctx);
	requireActiveWorkspaceScope(ctx, input.workspaceId);
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
	return (
		connection.embeddedEditorAccess === "edit" &&
		connection.permissionProfile !== "view" &&
		canEditContent(role)
	);
}

// Client identity is supplied by the authenticated MCP transport, never the UI.
export const getEmbeddedWorkspaceUseCase = useCase
	.query("agents.getEmbeddedWorkspace")
	.input(EmbeddedWorkspaceInputSchema.extend(identity))
	.output(EmbeddedWorkspaceSchema)
	.run(async ({ ctx, input }) => {
		const canEdit = await access(ctx, input);
		const [pages, navigation, canvases, canvasNavigation] = await Promise.all([
			listPagesUseCase.run({ ctx, input }),
			getPageNavigationUseCase.run({ ctx, input }),
			listCanvasesUseCase.run({ ctx, input }),
			getCanvasNavigationUseCase.run({ ctx, input }),
		]);
		return {
			canEdit,
			pages: pages.items.map((p) => ({
				pageId: p.id,
				title: p.title,
				icon: p.icon,
				parentPageId: p.parentPageId,
				updatedAt: p.updatedAt,
			})),
			favorites: navigation.favorites.map((p) => p.id),
			canvasFavorites: canvasNavigation.favorites.map((c) => c.id),
			canvases: canvases.items.map((c) => ({ id: c.id, title: c.title })),
		};
	});

export const actInEmbeddedWorkspaceUseCase = useCase
	.command("agents.actInEmbeddedWorkspace")
	.input(EmbeddedWorkspaceActionSchema.extend(identity))
	.output(WorkspaceActionResultSchema)
	.run(async ({ ctx, input }) => {
		if (!(await access(ctx, input))) throw appError("Forbidden");
		const op = input.operation;
		switch (op.action) {
			case "create-page": {
				const page = await createPageUseCase.run({
					ctx,
					input: {
						workspaceId: input.workspaceId,
						title: op.title,
						parentPageId: op.parentPageId,
						appendToParentContent: !op.atCursor,
					},
				});
				return { id: page.id };
			}
			case "create-canvas": {
				const canvas = await createCanvasUseCase.run({
					ctx,
					input: {
						workspaceId: input.workspaceId,
						pageId: op.pageId,
						title: op.title ?? "Untitled canvas",
					},
				});
				return { id: canvas.id };
			}
			case "move-page":
				await updatePageUseCase.run({
					ctx,
					input: { id: op.pageId, parentPageId: op.parentPageId },
				});
				return { id: op.pageId };
			case "archive-page":
				await deletePageUseCase.run({ ctx, input: { id: op.pageId } });
				return { id: op.pageId };
			case "restore-page":
				await restorePageUseCase.run({ ctx, input: { id: op.pageId } });
				return { id: op.pageId };
			case "favorite-page":
				await setPageFavoriteUseCase.run({
					ctx,
					input: { id: op.pageId, favorite: op.favorite },
				});
				return { id: op.pageId };
			case "favorite-canvas":
				await setCanvasFavoriteUseCase.run({
					ctx,
					input: { id: op.canvasId, favorite: op.favorite },
				});
				return { id: op.canvasId };
		}
	});

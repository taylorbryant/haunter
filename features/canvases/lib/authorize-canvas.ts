import type { AppContext } from "@/app-context";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";

export async function authorizeCanvas(
	ctx: AppContext,
	canvasId: string,
	write: boolean,
) {
	requireUser(ctx);
	const scope = requireActiveWorkspaceScope(ctx);
	const canvas = await ctx.ports.canvases.findById(scope, canvasId);
	if (!canvas) throw appError("CanvasNotFound");
	await ctx.gate.authorize(write ? "canvases.update" : "canvases.read", canvas);
	if (canvas.pageId) {
		const page = await ctx.ports.pages.findById(scope, canvas.pageId);
		if (!page || page.deletedAt) throw appError("CanvasNotFound");
		await ctx.gate.authorize(write ? "pages.update" : "pages.read", page);
	}
	return canvas;
}

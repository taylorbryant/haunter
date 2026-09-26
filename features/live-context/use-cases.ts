import "@beignet/core/server-only";
import type { AppContext } from "@/app-context";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import {
	type ActiveContext,
	type ActiveView,
	type StoredContext,
	GetActiveContextInputSchema,
	GetActiveContextOutputSchema,
	ListActiveSessionsOutputSchema,
	LIVE_CONTEXT_STALE_MS,
	PublishContextInputSchema,
	PublishContextOutputSchema,
	WorkspaceContextInputSchema,
} from "./schemas";

// Recheck resources on reads too: a cached selection must not expose an archived
// page or a deleted canvas for the remainder of its presence TTL.
async function resolveView(ctx: AppContext, view: ActiveView) {
	const scope = requireActiveWorkspaceScope(ctx);
	let pageTitle: string | null = null;
	let canvasTitle: string | null = null;
	if (view.pageId) {
		const page = await ctx.ports.pages.findMetaById(scope, view.pageId);
		if (!page || page.deletedAt !== null) return null;
		await ctx.gate.authorize("pages.read", page);
		pageTitle = page.title;
	}
	if (view.canvas) {
		const canvas = await ctx.ports.canvases.findMetaById(
			scope,
			view.canvas.canvasId,
		);
		if (!canvas || canvas.pageId !== view.pageId) return null;
		await ctx.gate.authorize("canvases.read", canvas);
		canvasTitle = canvas.title;
	}
	return { pageTitle, canvasTitle };
}

function contextOwner(ctx: AppContext, workspaceId: string) {
	const userId = requireUser(ctx).id;
	const scope = requireActiveWorkspaceScope(ctx, workspaceId);
	if (!ctx.ports.liveContext.isConfigured())
		throw appError("LiveContextUnavailable");
	return { userId, scope };
}

async function contextStorage<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch {
		throw appError("LiveContextUnavailable");
	}
}

async function decorate(
	ctx: AppContext,
	entry: StoredContext,
): Promise<ActiveContext | null> {
	if (!entry.view || entry.expiresAt <= Date.now()) return null;
	const titles = await resolveView(ctx, entry.view);
	if (!titles) return null;
	return {
		...entry,
		view: entry.view,
		...titles,
		stale: Date.now() - entry.lastSeenAt > LIVE_CONTEXT_STALE_MS,
		selectionComplete:
			(!entry.view.canvas ||
				entry.view.canvas.selectionCount ===
					entry.view.canvas.selectedShapeIds.length) &&
			(!entry.view.pageSelection ||
				entry.view.pageSelection.selectionCount ===
					entry.view.pageSelection.selectedBlockIds.length),
	};
}

export const publishLiveContextUseCase = useCase
	.command("liveContext.publish")
	.input(PublishContextInputSchema)
	.output(PublishContextOutputSchema)
	.run(async ({ ctx, input }) => {
		const { userId, scope } = contextOwner(ctx, input.workspaceId);
		if (input.expectedUserId !== userId) throw appError("Forbidden");
		if (input.view && !(await resolveView(ctx, input.view)))
			throw appError("ActiveSessionNotFound");
		return {
			accepted: await contextStorage(() =>
				ctx.ports.liveContext.publish(scope, userId, input),
			),
		};
	});

export const listActiveSessionsUseCase = useCase
	.query("liveContext.list")
	.input(WorkspaceContextInputSchema)
	.output(ListActiveSessionsOutputSchema)
	.run(async ({ ctx, input }) => {
		const { userId, scope } = contextOwner(ctx, input.workspaceId);
		const entries = await contextStorage(() =>
			ctx.ports.liveContext.list(scope, userId),
		);
		const sessions = await Promise.all(
			entries.map((entry) => decorate(ctx, entry)),
		);
		return {
			sessions: sessions
				.filter((entry): entry is ActiveContext => entry !== null)
				.sort((a, b) => b.lastSeenAt - a.lastSeenAt)
				.map(({ view, ...entry }) => ({
					...entry,
					pageId: view.pageId,
					canvasId: view.canvas?.canvasId ?? null,
					canvasPageId: view.canvas?.canvasPageId ?? null,
					selectionCount:
						view.canvas?.selectionCount ??
						view.pageSelection?.selectionCount ??
						0,
				})),
		};
	});

export const getActiveContextUseCase = useCase
	.query("liveContext.get")
	.input(GetActiveContextInputSchema)
	.output(GetActiveContextOutputSchema)
	.run(async ({ ctx, input }) => {
		const { userId, scope } = contextOwner(ctx, input.workspaceId);
		const entry = (
			await contextStorage(() => ctx.ports.liveContext.list(scope, userId))
		).find((value) => value.sessionId === input.sessionId);
		const context = entry ? await decorate(ctx, entry) : null;
		if (!context) throw appError("ActiveSessionNotFound");
		return { context };
	});

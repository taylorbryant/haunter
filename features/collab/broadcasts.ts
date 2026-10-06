import "@beignet/core/server-only";
import type { AppContext } from "@/app-context";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { defineChannelBinding } from "@/lib/broadcasting";
import {
	workspaceChanges,
	workspaceCanvasActivity,
	workspaceFavorites,
} from "./channels";

async function authorizeWorkspace({
	ctx,
	params,
}: {
	ctx: AppContext;
	params: { workspaceId: string };
}) {
	const user = requireUser(ctx);
	requireActiveWorkspaceScope(ctx, params.workspaceId);
	if (!(await ctx.ports.members.findRole(params.workspaceId, user.id))) {
		throw appError("Forbidden");
	}
}

export const workspaceChangesBinding = defineChannelBinding(workspaceChanges, {
	authorize: authorizeWorkspace,
});
export const workspaceCanvasActivityBinding = defineChannelBinding(
	workspaceCanvasActivity,
	{
		authorize: authorizeWorkspace,
	},
);

export const workspaceFavoritesBinding = defineChannelBinding(
	workspaceFavorites,
	{
		async authorize({ ctx, params }) {
			if (params.userId !== requireUser(ctx).id) throw appError("Forbidden");
			await authorizeWorkspace({ ctx, params });
		},
	},
);

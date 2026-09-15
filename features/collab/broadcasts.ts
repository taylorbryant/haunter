import "@beignet/core/server-only";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { defineChannelBinding } from "@/lib/broadcasting";
import { workspaceChanges } from "./channels";

export const workspaceChangesBinding = defineChannelBinding(workspaceChanges, {
	async authorize({ ctx, params }) {
		const user = requireUser(ctx);
		requireActiveWorkspaceScope(ctx, params.workspaceId);
		if (!(await ctx.ports.members.findRole(params.workspaceId, user.id))) {
			throw appError("Forbidden");
		}
	},
});

import { definePolicy, deny } from "@beignet/core/ports";
import {
	type AuthorizationContext,
	authorizeOwner,
} from "@/features/shared/authorization";
import type { Workspace } from "@/features/workspaces/schemas";

export const workspacePolicy = definePolicy({
	"workspaces.create": (ctx: AuthorizationContext) => {
		if (ctx.actor.type === "user") return true;
		return deny("You must be signed in to create workspaces.");
	},
	"workspaces.read": (ctx: AuthorizationContext, workspace: Workspace) =>
		authorizeOwner(ctx, workspace, "read", "workspace"),
	"workspaces.update": (ctx: AuthorizationContext, workspace: Workspace) =>
		authorizeOwner(ctx, workspace, "update", "workspace"),
	"workspaces.delete": (ctx: AuthorizationContext, workspace: Workspace) =>
		authorizeOwner(ctx, workspace, "delete", "workspace"),
});

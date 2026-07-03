import { definePolicy, deny } from "@beignet/core/ports";
import {
	type AuthorizationContext,
	authorizeOwner,
} from "@/features/shared/authorization";
import type { PageMeta } from "@/features/pages/schemas";

export const pagePolicy = definePolicy({
	"pages.create": (ctx: AuthorizationContext) => {
		if (ctx.actor.type === "user") return true;
		return deny("You must be signed in to create pages.");
	},
	"pages.read": (ctx: AuthorizationContext, page: PageMeta) =>
		authorizeOwner(ctx, page, "read", "page"),
	"pages.update": (ctx: AuthorizationContext, page: PageMeta) =>
		authorizeOwner(ctx, page, "update", "page"),
	"pages.delete": (ctx: AuthorizationContext, page: PageMeta) =>
		authorizeOwner(ctx, page, "delete", "page"),
});

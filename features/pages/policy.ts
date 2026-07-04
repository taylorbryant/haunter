import { definePolicy, deny } from "@beignet/core/ports";
import {
	type AuthorizationContext,
	authorizeTenant,
} from "@/features/shared/authorization";
import type { PageMeta } from "@/features/pages/schemas";

export const pagePolicy = definePolicy({
	"pages.create": (ctx: AuthorizationContext) => {
		if (ctx.actor.type === "user") return true;
		return deny("You must be signed in to create pages.");
	},
	"pages.read": (ctx: AuthorizationContext, page: PageMeta) =>
		authorizeTenant(ctx, page, "read", "page"),
	"pages.update": (ctx: AuthorizationContext, page: PageMeta) =>
		authorizeTenant(ctx, page, "update", "page"),
	"pages.delete": (ctx: AuthorizationContext, page: PageMeta) =>
		authorizeTenant(ctx, page, "delete", "page"),
});

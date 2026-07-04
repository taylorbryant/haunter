import { definePolicy } from "@beignet/core/ports";
import {
	type AuthorizationContext,
	authorizeTenant,
	authorizeTenantWrite,
	requireEditorRole,
} from "@/features/shared/authorization";
import type { PageMeta } from "@/features/pages/schemas";

export const pagePolicy = definePolicy({
	"pages.create": (ctx: AuthorizationContext) => requireEditorRole(ctx, "page"),
	"pages.read": (ctx: AuthorizationContext, page: PageMeta) =>
		authorizeTenant(ctx, page, "read", "page"),
	"pages.update": (ctx: AuthorizationContext, page: PageMeta) =>
		authorizeTenantWrite(ctx, page, "update", "page"),
	"pages.delete": (ctx: AuthorizationContext, page: PageMeta) =>
		authorizeTenantWrite(ctx, page, "delete", "page"),
});

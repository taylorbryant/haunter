import { definePolicy } from "@beignet/core/ports";
import type { CanvasListItem } from "@/features/canvases/schemas";
import {
	type AuthorizationContext,
	authorizeTenant,
	authorizeTenantWrite,
	requireEditorRole,
} from "@/features/shared/authorization";

export const canvasPolicy = definePolicy({
	"canvases.create": (ctx: AuthorizationContext) =>
		requireEditorRole(ctx, "canvas"),
	"canvases.read": (ctx: AuthorizationContext, canvas: CanvasListItem) =>
		authorizeTenant(ctx, canvas, "read", "canvas"),
	"canvases.update": (ctx: AuthorizationContext, canvas: CanvasListItem) =>
		authorizeTenantWrite(ctx, canvas, "update", "canvas"),
	"canvases.delete": (ctx: AuthorizationContext, canvas: CanvasListItem) =>
		authorizeTenantWrite(ctx, canvas, "delete", "canvas"),
});

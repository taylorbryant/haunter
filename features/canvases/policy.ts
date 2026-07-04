import { definePolicy } from "@beignet/core/ports";
import type { Canvas } from "@/features/canvases/schemas";
import {
	type AuthorizationContext,
	authorizeTenant,
	authorizeTenantWrite,
	requireEditorRole,
} from "@/features/shared/authorization";

export const canvasPolicy = definePolicy({
	"canvases.create": (ctx: AuthorizationContext) =>
		requireEditorRole(ctx, "canvas"),
	"canvases.read": (ctx: AuthorizationContext, canvas: Canvas) =>
		authorizeTenant(ctx, canvas, "read", "canvas"),
	"canvases.update": (ctx: AuthorizationContext, canvas: Canvas) =>
		authorizeTenantWrite(ctx, canvas, "update", "canvas"),
});

import { definePolicy, deny } from "@beignet/core/ports";
import type { Canvas } from "@/features/canvases/schemas";
import {
	type AuthorizationContext,
	authorizeTenant,
} from "@/features/shared/authorization";

export const canvasPolicy = definePolicy({
	"canvases.create": (ctx: AuthorizationContext) => {
		if (ctx.actor.type === "user") return true;
		return deny("You must be signed in to create canvases.");
	},
	"canvases.read": (ctx: AuthorizationContext, canvas: Canvas) =>
		authorizeTenant(ctx, canvas, "read", "canvas"),
	"canvases.update": (ctx: AuthorizationContext, canvas: Canvas) =>
		authorizeTenant(ctx, canvas, "update", "canvas"),
});

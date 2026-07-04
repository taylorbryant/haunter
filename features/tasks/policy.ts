import { definePolicy, deny } from "@beignet/core/ports";
import {
	type AuthorizationContext,
	authorizeTenant,
} from "@/features/shared/authorization";
import type { Task } from "@/features/tasks/schemas";

export const taskPolicy = definePolicy({
	"tasks.create": (ctx: AuthorizationContext) => {
		if (ctx.actor.type === "user") return true;
		return deny("You must be signed in to create tasks.");
	},
	"tasks.update": (ctx: AuthorizationContext, task: Task) =>
		authorizeTenant(ctx, task, "update", "task"),
	"tasks.delete": (ctx: AuthorizationContext, task: Task) =>
		authorizeTenant(ctx, task, "delete", "task"),
});

import { definePolicy } from "@beignet/core/ports";
import {
	type AuthorizationContext,
	authorizeTenantWrite,
	requireEditorRole,
} from "@/features/shared/authorization";
import type { Task } from "@/features/tasks/schemas";

export const taskPolicy = definePolicy({
	"tasks.create": (ctx: AuthorizationContext) => requireEditorRole(ctx, "task"),
	"tasks.update": (ctx: AuthorizationContext, task: Task) =>
		authorizeTenantWrite(ctx, task, "update", "task"),
	"tasks.delete": (ctx: AuthorizationContext, task: Task) =>
		authorizeTenantWrite(ctx, task, "delete", "task"),
});

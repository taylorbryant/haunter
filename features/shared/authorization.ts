import {
	type ActivityActor,
	type ActivityTenant,
	deny,
} from "@beignet/core/ports";
import { canEditContent } from "@/lib/org-roles";
import type { AuthSession } from "@/ports/auth";

export type AuthorizationContext = {
	actor: ActivityActor;
	auth: AuthSession | null;
	tenant?: ActivityTenant;
	membership?: { role: string };
};

type Scoped = { id: string; workspaceId: string };

/**
 * Authorize access to a workspace-scoped resource. The active tenant is the
 * caller's Better Auth organization — one they are a verified member of — so
 * membership in the resource's workspace is the whole check. Role granularity
 * (viewer vs editor) layers on top of this later.
 */
export function authorizeTenant(
	ctx: AuthorizationContext,
	resource: Scoped,
	action: string,
	noun: string,
) {
	if (ctx.actor.type !== "user") {
		return deny(`You must be signed in to ${action} ${noun}s.`);
	}

	if (!ctx.tenant || ctx.tenant.id !== resource.workspaceId) {
		return deny({
			reason: `You do not have access to this ${noun}.`,
			code: `NOT_${noun.toUpperCase()}_MEMBER`,
			details: { [`${noun}Id`]: resource.id },
		});
	}

	return true;
}

/**
 * Authorize a write to a workspace-scoped resource: membership plus an
 * editor-or-higher role. Viewers are read-only.
 */
export function authorizeTenantWrite(
	ctx: AuthorizationContext,
	resource: Scoped,
	action: string,
	noun: string,
) {
	const membership = authorizeTenant(ctx, resource, action, noun);
	if (membership !== true) return membership;

	if (!canEditContent(ctx.membership?.role)) {
		return deny({
			reason: `You have view-only access to this workspace.`,
			code: `${noun.toUpperCase()}_READ_ONLY`,
			details: { [`${noun}Id`]: resource.id },
		});
	}

	return true;
}

/**
 * Authorize a create (no resource yet): signed in, with an editor-or-higher
 * role in the active workspace.
 */
export function requireEditorRole(ctx: AuthorizationContext, noun: string) {
	if (ctx.actor.type !== "user") {
		return deny(`You must be signed in to create ${noun}s.`);
	}

	if (!canEditContent(ctx.membership?.role)) {
		return deny(`You have view-only access to this workspace.`);
	}

	return true;
}

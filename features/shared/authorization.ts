import {
	type ActivityActor,
	type ActivityTenant,
	deny,
} from "@beignet/core/ports";
import type { AuthSession } from "@/ports/auth";

export type AuthorizationContext = {
	actor: ActivityActor;
	auth: AuthSession | null;
	tenant?: ActivityTenant;
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

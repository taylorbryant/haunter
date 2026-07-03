import { type ActivityActor, deny } from "@beignet/core/ports";
import type { AuthSession } from "@/ports/auth";

export type AuthorizationContext = {
	actor: ActivityActor;
	auth: AuthSession | null;
};

type Owned = { id: string; userId: string };

export function authorizeOwner(
	ctx: AuthorizationContext,
	resource: Owned,
	action: string,
	noun: string,
) {
	if (ctx.actor.type !== "user") {
		return deny(`You must be signed in to ${action} ${noun}s.`);
	}

	if (resource.userId !== ctx.actor.id) {
		return deny({
			reason: `Only the owner can ${action} this ${noun}.`,
			code: `NOT_${noun.toUpperCase()}_OWNER`,
			details: { [`${noun}Id`]: resource.id },
		});
	}

	return true;
}

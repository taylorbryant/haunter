import {
	requireTenantScope,
	type TenantScope,
	tenantScopeId,
} from "@beignet/core/ports";
import type { AppContext } from "@/app-context";
import { appError } from "@/features/shared/errors";
import {
	ACCESS_STATUS_APPROVED,
	ADMIN_ROLE,
	type AuthSession,
	type AuthUser,
} from "@/ports/auth";

export function requireSession(ctx: AppContext): AuthSession {
	if (!ctx.auth) {
		throw appError("Unauthorized");
	}

	return ctx.auth;
}

export function isApprovedUser(
	user: Pick<AuthUser, "accessStatus"> | null | undefined,
): boolean {
	return user?.accessStatus === ACCESS_STATUS_APPROVED;
}

export async function hasAppAccess(
	ctx: Pick<AppContext, "auth" | "membership"> & {
		ports: Pick<AppContext["ports"], "members">;
	},
): Promise<boolean> {
	if (!ctx.auth) return false;
	if (isApprovedUser(ctx.auth.user) || ctx.membership) return true;

	// A stale active organization must not lock an invited user out of another
	// workspace they still belong to. This authoritative lookup grants app entry
	// only; request context still withholds tenant scope until the active member
	// row itself has been verified.
	return (await ctx.ports.members.listForUser(ctx.auth.user.id)).length > 0;
}

/** True when the user holds the app-wide admin role. */
export function isAdmin(
	user: Pick<AuthUser, "role"> | null | undefined,
): boolean {
	return user?.role === ADMIN_ROLE;
}

/**
 * Assert the caller is an app-wide admin. Admins reach the waitlist surface
 * regardless of workspace membership, so this checks the role directly rather
 * than going through requireUser (which gates on approval/membership).
 */
export function requireAdmin(ctx: AppContext): AuthUser {
	const session = requireSession(ctx);
	if (!isAdmin(session.user)) {
		throw appError("Forbidden", {
			message: "Admin access required.",
		});
	}
	return session.user;
}

export function requireUser(ctx: AppContext): AuthUser {
	const session = requireSession(ctx);
	if (!isApprovedUser(session.user) && !ctx.membership) {
		throw appError("Forbidden", {
			message: "Your account is still on the waitlist.",
		});
	}

	return session.user;
}

/**
 * The signed-in user's active workspace (a Better Auth organization). Request
 * context exposes this tenant only after resolving a current member row, so a
 * stale `activeOrganizationId` never becomes repository scope.
 */
export function requireActiveWorkspaceId(ctx: AppContext): string {
	return tenantScopeId(requireActiveWorkspaceScope(ctx));
}

/**
 * Return the request's already-resolved tenant as an opaque repository scope.
 * Route workspace ids are selectors only; they never become repository scope
 * unless they match the authenticated session's active organization.
 */
export function requireActiveWorkspaceScope(
	ctx: AppContext,
	workspaceId?: string,
): TenantScope {
	requireUser(ctx);
	const scope = requireTenantScope(ctx, {
		error: () =>
			appError("Forbidden", {
				message: "Select a workspace before continuing.",
			}),
	});

	if (workspaceId !== undefined && tenantScopeId(scope) !== workspaceId) {
		throw appError("Forbidden", {
			message: "You do not have access to this workspace.",
			details: { workspaceId },
		});
	}

	return scope;
}

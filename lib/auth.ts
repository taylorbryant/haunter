import { requireTenantId } from "@beignet/core/ports";
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

export function hasAppAccessSession(
	session:
		| {
				user?: Pick<AuthUser, "accessStatus"> | null;
				session?: { activeOrganizationId?: string | null } | null;
		  }
		| null
		| undefined,
): boolean {
	return Boolean(
		session &&
			(isApprovedUser(session.user) || session.session?.activeOrganizationId),
	);
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
 * The signed-in user's active workspace (a Better Auth organization). Better
 * Auth only writes `activeOrganizationId` to an org the session is a verified
 * member of, so a present tenant id is proof of membership — the tenant is the
 * unit of access.
 */
export function requireActiveWorkspaceId(ctx: AppContext): string {
	requireUser(ctx);
	return requireTenantId(ctx);
}

/**
 * Assert the requested workspace is the caller's active workspace, then return
 * its id. Cross-workspace access (a member acting outside their active org) is
 * refused — one active tenant at a time.
 */
export function requireActiveWorkspace(
	ctx: AppContext,
	workspaceId: string,
): string {
	const activeId = requireActiveWorkspaceId(ctx);
	if (activeId !== workspaceId) {
		throw appError("Forbidden", {
			message: "You do not have access to this workspace.",
			details: { workspaceId },
		});
	}
	return workspaceId;
}

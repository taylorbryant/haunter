import { requireTenantId } from "@beignet/core/ports";
import type { AppContext } from "@/app-context";
import { appError } from "@/features/shared/errors";
import type { AuthSession, AuthUser } from "@/ports/auth";

export function requireSession(ctx: AppContext): AuthSession {
	if (!ctx.auth) {
		throw appError("Unauthorized");
	}

	return ctx.auth;
}

export function requireUser(ctx: AppContext): AuthUser {
	return requireSession(ctx).user;
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

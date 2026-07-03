import type { AppContext } from "@/app-context";
import type { AuthSession, AuthUser } from "@/ports/auth";
import { appError } from "@/features/shared/errors";

export function requireSession(ctx: AppContext): AuthSession {
	if (!ctx.auth) {
		throw appError("Unauthorized");
	}

	return ctx.auth;
}

export function requireUser(ctx: AppContext): AuthUser {
	return requireSession(ctx).user;
}

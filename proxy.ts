import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Optimistic auth gate: redirect visitors without a session cookie straight
 * to the sign-in page. This is a fast-path only — real session validation
 * happens in the (app) layout and in every use case (`requireUser`).
 */
export function proxy(request: NextRequest) {
	const sessionCookie = getSessionCookie(request);

	if (!sessionCookie) {
		return NextResponse.redirect(new URL("/sign-in", request.url));
	}

	return NextResponse.next();
}

export const config = {
	// Everything except auth pages, API routes (they return 401s themselves),
	// and Next.js static assets.
	matcher: [
		"/((?!api|_next/static|_next/image|favicon.ico|sign-in|sign-up).*)",
	],
};

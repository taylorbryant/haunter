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
		const signIn = new URL("/sign-in", request.url);
		// Preserve the destination (e.g. an agent approval link) through the
		// sign-in flow; the OTP form only follows same-origin relative paths.
		signIn.searchParams.set(
			"next",
			request.nextUrl.pathname + request.nextUrl.search,
		);
		return NextResponse.redirect(signIn);
	}

	return NextResponse.next();
}

export const config = {
	// Everything except auth pages, API routes (they return 401s themselves),
	// and Next.js static assets.
	matcher: [
		// accept-invite handles its own signed-out state (it prompts sign-in), so
		// invitees who aren't signed in yet must not be bounced away from it.
		// .well-known serves anonymous protocol discovery (agent-configuration).
		"/((?!api|_next/static|_next/image|favicon.ico|sign-in|sign-up|accept-invite|share|\\.well-known).*)",
	],
};

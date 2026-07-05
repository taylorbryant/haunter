import "@beignet/core/server-only";
import { env } from "./env";

const isProduction = env.NODE_ENV === "production";

/**
 * The auth layer's mail goes through the app's mailer/logger ports rather
 * than a parallel untracked client. The dynamic import breaks the module
 * cycle (the server's providers import lib/better-auth.ts, which imports
 * this file for its OTP/invite callbacks). getServer is memoized, so the
 * worst case is one server boot when a sign-in arrives before any contract
 * route has run — after that it's a cached promise.
 */
async function appPorts() {
	const { getServer } = await import("@/server");
	const { ports } = await getServer();
	return ports;
}

/** Email a one-time sign-in code (and log it in development). */
export async function sendLoginCode(
	email: string,
	code: string,
): Promise<void> {
	const ports = await appPorts();

	// Surfacing the code in dev keeps sign-in working without real delivery.
	if (!isProduction) {
		ports.logger.info(`[auth] Sign-in code for ${email}: ${code}`);
	}

	try {
		await ports.mailer.send({
			to: email,
			subject: "Your Haunter sign-in code",
			text: `Your Haunter sign-in code is ${code}. It expires in 5 minutes. If you didn't request this, you can ignore this email.`,
			html: `<p>Your Haunter sign-in code is <strong style="font-size:1.25rem;letter-spacing:0.1em">${code}</strong>.</p><p>It expires in 5 minutes. If you didn't request this, you can ignore this email.</p>`,
		});
	} catch (error) {
		// In dev the code is in the log, so a delivery hiccup shouldn't
		// block sign-in; in production the failure must surface.
		if (isProduction) throw error;
		ports.logger.warn("Failed to send sign-in email", { error });
	}
}

/** Email a workspace invitation (and log the accept link in development). */
export async function sendWorkspaceInvite(params: {
	email: string;
	inviterName: string;
	workspaceName: string;
	acceptUrl: string;
}): Promise<void> {
	const { email, inviterName, workspaceName, acceptUrl } = params;
	const ports = await appPorts();

	if (!isProduction) {
		ports.logger.info(
			`[invite] ${inviterName} invited ${email} to "${workspaceName}": ${acceptUrl}`,
		);
	}

	try {
		await ports.mailer.send({
			to: email,
			subject: `${inviterName} invited you to ${workspaceName} on Haunter`,
			text: `${inviterName} invited you to join the "${workspaceName}" workspace on Haunter. Accept the invitation: ${acceptUrl}`,
			html: `<p><strong>${inviterName}</strong> invited you to join the <strong>${workspaceName}</strong> workspace on Haunter.</p><p><a href="${acceptUrl}">Accept invitation</a></p>`,
		});
	} catch (error) {
		if (isProduction) throw error;
		ports.logger.warn("Failed to send invitation email", { error });
	}
}

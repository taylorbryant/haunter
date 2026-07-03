import "@beignet/core/server-only";
import { createResendMailer } from "@beignet/provider-mail-resend";
import { Resend } from "resend";
import { env } from "./env";

// Beignet's Resend mailer. The app is also registered with the full Resend
// provider (server/providers.ts); this standalone instance lets the auth layer
// — which runs outside the app context — send without a bootstrap cycle.
const mailer = env.RESEND_API_KEY
	? createResendMailer({
			client: new Resend(env.RESEND_API_KEY),
			from: env.RESEND_FROM,
		})
	: null;

const isProduction = env.NODE_ENV === "production";

/** Email a one-time sign-in code (and log it in development). */
export async function sendLoginCode(email: string, code: string): Promise<void> {
	// Surfacing the code in dev keeps sign-in working without real delivery.
	if (!isProduction) {
		console.info(`[auth] Sign-in code for ${email}: ${code}`);
	}

	if (!mailer) return;

	try {
		await mailer.send({
			to: email,
			subject: "Your Haunter sign-in code",
			text: `Your Haunter sign-in code is ${code}. It expires in 5 minutes. If you didn't request this, you can ignore this email.`,
			html: `<p>Your Haunter sign-in code is <strong style="font-size:1.25rem;letter-spacing:0.1em">${code}</strong>.</p><p>It expires in 5 minutes. If you didn't request this, you can ignore this email.</p>`,
		});
	} catch (error) {
		// In dev the code is in the console, so a delivery hiccup shouldn't
		// block sign-in; in production the failure must surface.
		if (isProduction) throw error;
		console.warn("[auth] Failed to send sign-in email:", error);
	}
}

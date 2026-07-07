/**
 * Content of the "you're off the waitlist" email. Pure — no infra imports — so
 * it stays inside the use-case layer; the use-case hands it to the mailer port.
 */
export function buildApprovalEmail(params: {
	name: string;
	signInUrl: string;
}): { subject: string; text: string; html: string } {
	const greeting = params.name ? `Hi ${params.name},` : "Hi,";
	return {
		subject: "You're off the Haunter waitlist",
		text: `${greeting}\n\nGood news — your Haunter account has been approved. You can sign in now: ${params.signInUrl}`,
		html: `<p>${greeting}</p><p>Good news — your Haunter account has been approved. You can <a href="${params.signInUrl}">sign in now</a>.</p>`,
	};
}

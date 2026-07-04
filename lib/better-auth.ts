import { createClient } from "@libsql/client";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP, organization } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/libsql";
import { ensureDatabaseReady } from "@/infra/db/database-ready";
import * as schema from "@/infra/db/schema";
import { env } from "@/lib/env";
import { sendLoginCode, sendWorkspaceInvite } from "@/lib/mail";
import { accessControl, roles } from "@/lib/org-access";

const client = createClient({
	url: env.SQLITE_DB_URL,
	authToken: env.SQLITE_DB_AUTH_TOKEN,
});

// Auth routes can be the first thing to touch the database, before any
// Beignet provider boots, so readiness is enforced here too.
await ensureDatabaseReady(client);

const db = drizzle(client, { schema });

const trustedOrigins = [
	env.APP_URL,
	env.BETTER_AUTH_URL,
	...(env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean) ?? []),
];

export const auth = betterAuth({
	baseURL: env.BETTER_AUTH_URL,
	secret: env.BETTER_AUTH_SECRET,
	trustedOrigins: [...new Set(trustedOrigins)],
	database: drizzleAdapter(db, {
		provider: "sqlite",
		schema,
	}),
	plugins: [
		// Passwordless auth: a 6-digit code emailed on sign-in (and sign-up —
		// unknown emails create an account). The code verifies the address, so
		// no separate email-verification step is needed.
		emailOTP({
			otpLength: 6,
			expiresIn: 60 * 5,
			async sendVerificationOTP({ email, otp }) {
				await sendLoginCode(email, otp);
			},
		}),
		// A "workspace" in the product is an organization here. Members carry a
		// role (owner/admin/member/viewer) that the app's gate reads to decide
		// content-edit rights; viewers are read-only.
		organization({
			ac: accessControl,
			roles,
			async sendInvitationEmail(data) {
				await sendWorkspaceInvite({
					email: data.email,
					inviterName: data.inviter.user.name,
					workspaceName: data.organization.name,
					acceptUrl: `${env.APP_URL}/accept-invite/${data.id}`,
				});
			},
		}),
	],
	// With no passwords, "fresh session" is the only re-auth signal better-auth
	// could require for deleting an account. Treat sessions as always fresh so
	// the type-to-confirm delete flow works session-authenticated.
	session: {
		freshAge: 0,
	},
	user: {
		changeEmail: {
			enabled: true,
		},
		deleteUser: {
			enabled: true,
		},
	},
});

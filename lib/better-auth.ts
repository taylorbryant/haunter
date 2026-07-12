import { agentAuth } from "@better-auth/agent-auth";
import { createClient } from "@libsql/client";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, emailOTP, organization } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/libsql";
import { createDrizzleAdminUserRepository } from "@/infra/admin/drizzle-admin-user-repository";
import { ensureDatabaseReady } from "@/infra/db/database-ready";
import * as schema from "@/infra/db/schema";
import {
	createHaunterAgentAuthAdapter,
	type HaunterAgentCapabilityExecutor,
} from "@/lib/agent-auth-adapter";
import { createAuthRateLimitStorage } from "@/lib/auth-rate-limit";
import { env } from "@/lib/env";
import { sendLoginCode, sendWorkspaceInvite } from "@/lib/mail";
import { accessControl, roles } from "@/lib/org-access";
import {
	ACCESS_STATUS_APPROVED,
	ACCESS_STATUS_WAITLISTED,
	ADMIN_ROLE,
} from "@/ports/auth";
import type { AgentCapabilityServer } from "@/server/agent-capabilities";

const client = createClient({
	url: env.SQLITE_DB_URL,
	authToken: env.SQLITE_DB_AUTH_TOKEN,
});

// Auth routes can be the first thing to touch the database, before any
// Beignet provider boots, so readiness is enforced here too.
await ensureDatabaseReady(client);

const db = drizzle(client, { schema });
const adminUsers = createDrizzleAdminUserRepository(db);

const authRateLimitStorage = createAuthRateLimitStorage();

async function executeAgentCapabilityDynamic(
	invocation: Parameters<HaunterAgentCapabilityExecutor["executeDynamic"]>[0],
) {
	const [{ createHaunterAgentCapabilityExecutor }, serverModule] =
		await Promise.all([
			import("@/server/agent-capabilities"),
			import("@/server") as Promise<unknown>,
		]);
	const { getServer } = serverModule as {
		getServer(): Promise<AgentCapabilityServer>;
	};
	return (
		await createHaunterAgentCapabilityExecutor({ getServer })
	).executeDynamic(invocation);
}

const lazyAgentCapabilityExecutor: HaunterAgentCapabilityExecutor = {
	execute: (async (invocation) =>
		executeAgentCapabilityDynamic(
			invocation,
		)) as HaunterAgentCapabilityExecutor["execute"],
	executeDynamic: executeAgentCapabilityDynamic,
};

const agentCapabilityAdapter = createHaunterAgentAuthAdapter(
	lazyAgentCapabilityExecutor,
);

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
	databaseHooks: env.BOOTSTRAP_ADMIN_EMAIL
		? {
				user: {
					create: {
						async before(user) {
							if (
								!user.emailVerified ||
								user.email.trim().toLowerCase() !== env.BOOTSTRAP_ADMIN_EMAIL ||
								(await adminUsers.hasAdmin())
							) {
								return;
							}

							// OTP verification happens before Better Auth creates this row. Only
							// the configured inbox owner can reach this hook, and the unique
							// email constraint prevents two bootstrap rows from being created.
							return {
								data: {
									...user,
									accessStatus: ACCESS_STATUS_APPROVED,
									role: ADMIN_ROLE,
								},
							};
						},
					},
				},
			}
		: undefined,
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
		// App-wide administration: an "admin"-role user can list/manage users,
		// set roles, ban, and impersonate through /api/auth/admin/*. This is
		// distinct from the per-workspace member roles the organization plugin
		// governs — admin is global to the app, not scoped to a workspace.
		admin(),
		// A "workspace" in the product is an organization here. Members carry a
		// role (owner/admin/member/viewer) that the app's gate reads to decide
		// content-edit rights; viewers are read-only.
		organization({
			ac: accessControl,
			roles,
			requireEmailVerificationOnInvitation: true,
			allowUserToCreateOrganization(user) {
				return user.accessStatus === ACCESS_STATUS_APPROVED;
			},
			async sendInvitationEmail(data) {
				await sendWorkspaceInvite({
					email: data.email,
					inviterName: data.inviter.user.name,
					workspaceName: data.organization.name,
					acceptUrl: `${env.APP_URL}/accept-invite/${data.id}`,
				});
			},
		}),
		// AI agents as first-class collaborators (Agent Auth Protocol). Agents
		// register, request capabilities, and execute them with their own JWT
		// identity; execution runs through the same gate-authorized use cases
		// as human requests. Delegated mode only — every agent acts for a real
		// member and inherits at most that member's rights.
		agentAuth({
			...agentCapabilityAdapter,
			providerName: "haunter",
			providerDescription:
				"Haunter productivity: manage pages and tasks in workspaces the acting user belongs to.",
			modes: ["delegated"],
			// Lets agents self-register with an embedded key (OAuth-device-flow
			// style) instead of requiring a pre-enrolled host. Registration
			// alone grants nothing: delegated agents start pending with every
			// capability pending until a signed-in user approves them with the
			// user code at /device/capabilities.
			allowDynamicHostRegistration: true,
			// Passwordless app: sessions are always "fresh" (session.freshAge 0
			// below), so the plugin's re-auth window would block every approval.
			// The device user code is the approval's proof instead.
			freshSessionWindow: 0,
		}),
	],
	// Better Auth's own limiter is the only throttle on /api/auth/* (Beignet's
	// contract hooks don't see those routes). Its defaults already cover the
	// abuse-prone paths — OTP send 3/min, sign-in 3/10s, both per IP — but the
	// default memory store resets per serverless instance, so back it with
	// Upstash when configured and force it on (default is production-only).
	// Without Upstash, Better Auth's defaults stand: memory store, production
	// only — best-effort, but never weaker than before.
	rateLimit: authRateLimitStorage
		? { enabled: true, customStorage: authRateLimitStorage }
		: undefined,
	// With no passwords, "fresh session" is the only re-auth signal better-auth
	// could require for deleting an account. Treat sessions as always fresh so
	// the type-to-confirm delete flow works session-authenticated.
	session: {
		freshAge: 0,
		// Serve getSession from a signed cookie instead of a remote-DB lookup —
		// that lookup was a ~100-150ms tax on every API request and layout
		// render. Thirty minutes, not five: only Better Auth's own routes can
		// refresh the cookie (contract routes can't set cookies), so with a
		// 5-minute TTL most browsing happened outside the hit window and paid
		// the DB lookup anyway (measured: context 44ms on hit vs ~130ms on
		// miss). Sign-out clears it; a revoked session lives at most this
		// long. Role checks are unaffected (membership is resolved per request
		// in the app context).
		cookieCache: {
			enabled: true,
			maxAge: 30 * 60,
		},
	},
	user: {
		additionalFields: {
			accessStatus: {
				type: "string",
				required: true,
				defaultValue: ACCESS_STATUS_WAITLISTED,
				input: false,
			},
		},
		changeEmail: {
			enabled: true,
		},
		deleteUser: {
			enabled: true,
		},
	},
});

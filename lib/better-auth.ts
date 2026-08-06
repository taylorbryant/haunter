import { agentAuth } from "@better-auth/agent-auth";
import { oauthProvider } from "@better-auth/oauth-provider";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, emailOTP, jwt, organization } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/libsql";
import { createDrizzleAdminUserRepository } from "@/infra/admin/drizzle-admin-user-repository";
import { createDrizzleMcpOAuthClientRepository } from "@/infra/agents/drizzle-mcp-oauth-client-repository";
import { databaseClient } from "@/infra/db/client";
import { ensureDatabaseReady } from "@/infra/db/database-ready";
import * as schema from "@/infra/db/schema";
import { createHaunterAgentAuthAdapter } from "@/lib/agent-auth-adapter";
import { createAuthRateLimitStorage } from "@/lib/auth-rate-limit";
import { buildAuthAllowedHosts } from "@/lib/better-auth-hosts";
import { env } from "@/lib/env";
import { sendLoginCode, sendWorkspaceInvite } from "@/lib/mail";
import { mcpResourceUrl, oauthIssuerUrl } from "@/lib/mcp-configuration";
import {
	applyOAuthDcrAllocationMetadata,
	OAUTH_DCR_CLEANUP_LIMIT,
	OAUTH_DCR_MAX_UNUSED_CLIENTS,
	OAUTH_DCR_MAX_UNUSED_CLIENTS_PER_SOURCE,
	OAUTH_DCR_UNUSED_CLIENT_TTL_MS,
} from "@/lib/oauth-dcr-request";
import { accessControl, roles } from "@/lib/org-access";
import {
	ACCESS_STATUS_APPROVED,
	ACCESS_STATUS_WAITLISTED,
	ADMIN_ROLE,
} from "@/ports/auth";
import type { AgentCapabilityServer } from "@/server/agent-capabilities";

// Auth routes can be the first thing to touch the database, before any
// Beignet provider boots, so readiness is enforced here too.
await ensureDatabaseReady(databaseClient);

const db = drizzle(databaseClient, { schema });
const adminUsers = createDrizzleAdminUserRepository(db);
const mcpOAuthClients = createDrizzleMcpOAuthClientRepository(db);
const baseDatabaseAdapter = drizzleAdapter(db, {
	provider: "sqlite",
	schema,
});
const boundedOAuthDatabaseAdapter = (
	options: Parameters<typeof baseDatabaseAdapter>[0],
) => {
	const adapter = baseDatabaseAdapter(options);
	return {
		...adapter,
		create(input: Parameters<typeof adapter.create>[0]) {
			// Better Auth's DCR request schema strips extension fields before
			// persistence. The request wrapper carries the HMAC partition in
			// AsyncLocalStorage, and this adapter boundary adds it only to the
			// OAuth client row created in that request.
			return adapter.create({
				...input,
				data:
					input.model === "oauthClient"
						? applyOAuthDcrAllocationMetadata(input.data)
						: input.data,
			});
		},
	};
};

const authRateLimitStorage = createAuthRateLimitStorage();

const authBaseUrl = env.BETTER_AUTH_URL ?? env.APP_URL;

export { mcpResourceUrl, oauthIssuerUrl };

export async function prepareDynamicOAuthClientRegistration(
	allocationKey: string,
	now = new Date(),
) {
	await mcpOAuthClients.retireUnusedDynamicBefore(
		new Date(now.getTime() - OAUTH_DCR_UNUSED_CLIENT_TTL_MS),
		OAUTH_DCR_CLEANUP_LIMIT,
	);
	const [globalCount, sourceCount] = await Promise.all([
		mcpOAuthClients.countUnusedDynamic(),
		mcpOAuthClients.countUnusedDynamic(allocationKey),
	]);
	return (
		globalCount < OAUTH_DCR_MAX_UNUSED_CLIENTS &&
		sourceCount < OAUTH_DCR_MAX_UNUSED_CLIENTS_PER_SOURCE
	);
}

export async function isDynamicOAuthClientRegistrationAtCapacity(
	allocationKey: string,
) {
	const [globalCount, sourceCount] = await Promise.all([
		mcpOAuthClients.countUnusedDynamic(),
		mcpOAuthClients.countUnusedDynamic(allocationKey),
	]);
	return (
		globalCount >= OAUTH_DCR_MAX_UNUSED_CLIENTS ||
		sourceCount >= OAUTH_DCR_MAX_UNUSED_CLIENTS_PER_SOURCE
	);
}

const agentCapabilityAdapter = createHaunterAgentAuthAdapter(async () => {
	const [{ createHaunterAgentCapabilityExecutor }, serverModule] =
		await Promise.all([
			import("@/server/agent-capabilities"),
			import("@/server") as Promise<unknown>,
		]);
	const { getServer } = serverModule as {
		getServer(): Promise<AgentCapabilityServer>;
	};
	return createHaunterAgentCapabilityExecutor({ getServer });
});

const trustedOrigins = [
	env.APP_URL,
	authBaseUrl,
	...(env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean) ?? []),
];
const allowedAuthHosts = buildAuthAllowedHosts({
	appUrl: env.APP_URL,
	betterAuthUrl: authBaseUrl,
	additionalHosts: env.BETTER_AUTH_ALLOWED_HOSTS,
	vercelUrl: env.VERCEL_URL,
	vercelBranchUrl: env.VERCEL_BRANCH_URL,
	vercelProjectProductionUrl: env.VERCEL_PROJECT_PRODUCTION_URL,
});
const hasDynamicAuthHosts = Boolean(
	env.BETTER_AUTH_ALLOWED_HOSTS?.length ||
		env.VERCEL_URL ||
		env.VERCEL_BRANCH_URL ||
		env.VERCEL_PROJECT_PRODUCTION_URL,
);

const databaseHooks: BetterAuthOptions["databaseHooks"] =
	env.BOOTSTRAP_ADMIN_EMAIL
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
		: undefined;

export const auth = betterAuth({
	// Resolve the request-specific URL for previews and multi-domain installs.
	// Single-domain installs retain their existing static URL behavior, including
	// support for a configured base path. Better Auth automatically adds dynamic
	// allowed hosts to trustedOrigins.
	baseURL: hasDynamicAuthHosts
		? { allowedHosts: allowedAuthHosts, protocol: "auto" }
		: authBaseUrl,
	secret: env.BETTER_AUTH_SECRET,
	trustedOrigins: [...new Set(trustedOrigins)],
	database: boundedOAuthDatabaseAdapter,
	databaseHooks,
	plugins: [
		// OAuth 2.1 authorization server for Haunter's hosted MCP endpoint.
		// Tokens are audience-bound to the canonical MCP URL; application-level
		// permission profiles and workspace access are still checked per call.
		jwt({
			jwt: {
				issuer: oauthIssuerUrl,
			},
		}),
		oauthProvider({
			loginPage: "/sign-in",
			consentPage: "/oauth/consent",
			validAudiences: [mcpResourceUrl],
			scopes: ["openid", "offline_access", "haunter:mcp"],
			clientRegistrationDefaultScopes: [
				"openid",
				"offline_access",
				"haunter:mcp",
			],
			clientRegistrationAllowedScopes: [
				"openid",
				"offline_access",
				"haunter:mcp",
			],
			grantTypes: ["authorization_code", "refresh_token"],
			allowDynamicClientRegistration: true,
			// Manual OAuth client management is administrative. MCP DCR is
			// deliberately made sessionless by the route wrapper below, so a
			// waitlisted browser session cannot create owner-scoped clients
			// outside the bounded DCR lifecycle.
			clientPrivileges: ({ user }) => user?.role === ADMIN_ROLE,
			// Current MCP clients commonly implement RFC 7591 without an initial
			// access token. Registration creates no user grant; every user still
			// sees Haunter's consent screen before a token is issued.
			allowUnauthenticatedClientRegistration: true,
			silenceWarnings: {
				// This path is exported explicitly by the Next app because the
				// issuer includes Better Auth's /api/auth base path.
				oauthAuthServerConfig: true,
			},
		}),
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
	rateLimit: {
		...(authRateLimitStorage
			? { enabled: true, customStorage: authRateLimitStorage }
			: {}),
		customRules: {
			// Dynamic registration is intentionally public for standards-based
			// MCP clients, but it must not be an unbounded database-write path.
			"/oauth2/register": { window: 60, max: 5 },
			"/oauth2/authorize": { window: 60, max: 30 },
			"/oauth2/token": { window: 60, max: 60 },
		},
	},
	// With no passwords, "fresh session" is the only re-auth signal better-auth
	// could require for deleting an account. Treat sessions as always fresh so
	// the type-to-confirm delete flow works session-authenticated.
	session: {
		freshAge: 0,
		// Serve getSession from a signed cookie instead of a remote-DB lookup —
		// that lookup was a ~100-150ms tax on every API request and layout
		// render. Thirty minutes gives returning navigation more time to reuse
		// the signed session. Sign-out clears it; a revoked session lives at most
		// this long. Role checks are unaffected because membership is resolved per
		// request in the app context.
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

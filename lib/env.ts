import { createEnv } from "@beignet/core/config";
import { z } from "zod";

const BooleanEnv = z
	.enum(["true", "false"])
	.transform((value) => value === "true");
const AuthHostPattern = z
	.string()
	.trim()
	.min(1)
	.refine(
		(value) => !value.includes("://") && !/[\s/,]/.test(value),
		"Use a hostname or hostname pattern without a protocol or path.",
	);
const AuthHostPatterns = z
	.string()
	.transform((value) => value.split(",").map((host) => host.trim()))
	.pipe(z.array(AuthHostPattern).min(1));
const McpResourceUrl = z
	.string()
	.url()
	.refine((value) => {
		const url = new URL(value);
		return (
			url.pathname.replace(/\/$/, "") === "/mcp" &&
			url.search === "" &&
			url.hash === ""
		);
	}, "MCP_RESOURCE_URL must be the public /mcp endpoint without a query or hash.")
	.transform((value) => value.replace(/\/$/, ""));
const LOCAL_BETTER_AUTH_SECRET = "local-dev-better-auth-secret-change-me";
const isProductionRuntime =
	process.env.NODE_ENV === "production" &&
	process.env.NEXT_PHASE !== "phase-production-build";
const BetterAuthSecret = z
	.string()
	.min(32)
	.superRefine((value, ctx) => {
		if (isProductionRuntime && value === LOCAL_BETTER_AUTH_SECRET) {
			ctx.addIssue({
				code: "custom",
				message:
					"BETTER_AUTH_SECRET must be unique in production. Generate a strong secret instead of using the local development placeholder.",
			});
		}
	});

export const env = createEnv({
	server: {
		NODE_ENV: z
			.enum(["development", "test", "production"])
			.default("development"),
		APP_URL: z.string().url().default("http://localhost:3000"),
		CRON_SECRET: z.string().min(1).optional(),
		WEB_PUSH_PUBLIC_KEY: z.string().min(1).optional(),
		WEB_PUSH_PRIVATE_KEY: z.string().min(1).optional(),
		WEB_PUSH_SUBJECT: z
			.string()
			.regex(/^(mailto:|https:\/\/)/)
			.default("mailto:notifications@haunter.app"),
		DEVTOOLS_ENABLED: BooleanEnv.optional(),
		BETTER_AUTH_SECRET: isProductionRuntime
			? BetterAuthSecret
			: BetterAuthSecret.default(LOCAL_BETTER_AUTH_SECRET),
		// Optional when auth is served by this app: APP_URL is the canonical
		// origin. Set this only when Better Auth needs a different public origin.
		BETTER_AUTH_URL: z.string().url().optional(),
		// Canonical, audience-bound remote MCP endpoint. Keep this stable in
		// production even when the app also serves preview or alias domains.
		MCP_RESOURCE_URL: McpResourceUrl.optional(),
		// Optional browser origins allowed to call the MCP transport. Server-side
		// MCP clients generally omit Origin; present origins fail closed.
		MCP_ALLOWED_ORIGINS: z.string().optional(),
		BETTER_AUTH_ALLOWED_HOSTS: AuthHostPatterns.optional(),
		BETTER_AUTH_TRUSTED_ORIGINS: z.string().optional(),
		// Vercel supplies hostnames without a protocol. Exact deployment and
		// branch aliases let previews work without a broad *.vercel.app wildcard.
		VERCEL_URL: AuthHostPattern.optional(),
		VERCEL_BRANCH_URL: AuthHostPattern.optional(),
		VERCEL_PROJECT_PRODUCTION_URL: AuthHostPattern.optional(),
		BOOTSTRAP_ADMIN_EMAIL: z
			.string()
			.trim()
			.toLowerCase()
			.pipe(z.email())
			.optional(),
		SQLITE_DB_URL: z.string().default("file:local.db"),
		SQLITE_DB_AUTH_TOKEN: z.string().optional(),
		// Resend delivery for sign-in codes (the @beignet/provider-mail-resend
		// mailer). RESEND_FROM must be a verified sender in production;
		// resend.dev's shared address works for local testing.
		RESEND_API_KEY: z.string().optional(),
		RESEND_FROM: z.string().default("Haunter <onboarding@resend.dev>"),
		// Vercel Blob storage. When set, uploads live in Blob (private access);
		// otherwise the local ./storage directory is used (dev only — it does
		// not survive serverless deploys).
		BLOB_READ_WRITE_TOKEN: z.string().optional(),
		// Upstash Redis for durable rate limiting. When unset, an in-process
		// limiter is used (dev only — per-instance, not durable).
		UPSTASH_REDIS_REST_URL: z.string().optional(),
		UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
		// Key prefix shared with @beignet/provider-rate-limit-upstash (which
		// reads it directly); the default mirrors that provider's default.
		UPSTASH_PREFIX: z.string().default("beignet:ratelimit"),
		// Optional Liveblocks workspace events. SQLite remains authoritative;
		// Liveblocks only tells other open clients which projections to refetch.
		// Set this together with NEXT_PUBLIC_LIVEBLOCKS_AUTH=true at build time.
		LIVEBLOCKS_SECRET_KEY: z.string().optional(),
		LOG_LEVEL: z
			.enum(["trace", "debug", "info", "warn", "error", "fatal"])
			.default("info"),
		LOG_FORMAT: z.enum(["pretty", "json"]).default("json"),
		LOG_SERVICE: z.string().default("beignet-app"),
	},
	runtimeEnv: process.env,
});

export const isProduction = env.NODE_ENV === "production";

export const isDevtoolsEnabled =
	env.DEVTOOLS_ENABLED ?? process.env.NODE_ENV !== "production";

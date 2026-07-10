import { createEnv } from "@beignet/core/config";
import { z } from "zod";

const BooleanEnv = z
	.enum(["true", "false"])
	.transform((value) => value === "true");
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
		BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
		BETTER_AUTH_TRUSTED_ORIGINS: z.string().optional(),
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
		// Liveblocks room auth (permissioned collaboration). When set (together
		// with NEXT_PUBLIC_LIVEBLOCKS_AUTH=true on the client), room access is
		// granted per workspace membership via /api/liveblocks-auth. Without it
		// the client can still run in public-key prototyping mode.
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

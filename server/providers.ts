import "@beignet/core/server-only";
import { createDevtoolsProvider } from "@beignet/devtools";
import { createAuthBetterAuthProvider } from "@beignet/provider-auth-better-auth";
import { createInlineNotificationsProvider } from "@beignet/core/notifications";
import { createDrizzleSqliteProvider } from "@beignet/provider-db-drizzle/sqlite";
import { createPinoLoggerProvider } from "@beignet/provider-logger-pino";
import { createResendMailProvider } from "@beignet/provider-mail-resend";
import { createUpstashRateLimitProvider } from "@beignet/provider-rate-limit-upstash";
import { createLocalStorageProvider } from "@beignet/provider-storage-local";
import { createVercelBlobStorageProvider } from "@beignet/provider-storage-vercel-blob";
import { starterDatabaseProvider } from "@/infra/db/provider";
import * as schema from "@/infra/db/schema";
import { memoryRateLimitProvider } from "@/infra/rate-limit/memory-rate-limit-provider";
import { webPushProvider } from "@/infra/notifications/web-push-provider";
import { auth } from "@/lib/better-auth";
import { env } from "@/lib/env";
import type { AuthSessionMetadata, AuthUser } from "@/ports/auth";

const drizzleSqliteProvider = createDrizzleSqliteProvider({ schema });

export const providers = [
	createDevtoolsProvider(),
	createAuthBetterAuthProvider<AuthUser, AuthSessionMetadata>(auth),
	createPinoLoggerProvider(),
	drizzleSqliteProvider,
	starterDatabaseProvider,
	createInlineNotificationsProvider(),
	webPushProvider,
	// Vercel Blob in deployed environments (local disk doesn't survive
	// serverless); the local provider keeps dev working with zero setup.
	env.BLOB_READ_WRITE_TOKEN
		? createVercelBlobStorageProvider()
		: createLocalStorageProvider(),
	createResendMailProvider(),
	// Durable, shared rate limiting in deployed environments; the in-process
	// limiter keeps dev and tests working without Upstash credentials.
	env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
		? createUpstashRateLimitProvider()
		: memoryRateLimitProvider,
] as const;

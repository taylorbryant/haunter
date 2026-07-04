import "@beignet/core/server-only";
import { createDevtoolsProvider } from "@beignet/devtools";
import { createAuthBetterAuthProvider } from "@beignet/provider-auth-better-auth";
import { createDrizzleSqliteProvider } from "@beignet/provider-db-drizzle/sqlite";
import { loggerPinoProvider } from "@beignet/provider-logger-pino";
import { mailResendProvider } from "@beignet/provider-mail-resend";
import * as schema from "@/infra/db/schema";
import { starterDatabaseProvider } from "@/infra/db/provider";
import { memoryRateLimitProvider } from "@/infra/rate-limit/memory-rate-limit-provider";
import { vercelBlobStorageProvider } from "@/infra/storage/vercel-blob-storage";
import { auth } from "@/lib/better-auth";
import { env } from "@/lib/env";
import type { AuthSessionMetadata, AuthUser } from "@/ports/auth";
import { createLocalStorageProvider } from "@beignet/provider-storage-local";
import { upstashRateLimitProvider } from "@beignet/provider-rate-limit-upstash";

const drizzleSqliteProvider = createDrizzleSqliteProvider({ schema });

export const providers = [
	createDevtoolsProvider(),
	createAuthBetterAuthProvider<AuthUser, AuthSessionMetadata>(auth),
	loggerPinoProvider,
	drizzleSqliteProvider,
	starterDatabaseProvider,
	// Vercel Blob in deployed environments (local disk doesn't survive
	// serverless); the local provider keeps dev working with zero setup.
	env.BLOB_READ_WRITE_TOKEN
		? vercelBlobStorageProvider
		: createLocalStorageProvider(),
	mailResendProvider,
	// Durable, shared rate limiting in deployed environments; the in-process
	// limiter keeps dev and tests working without Upstash credentials.
	env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
		? upstashRateLimitProvider
		: memoryRateLimitProvider,
] as const;

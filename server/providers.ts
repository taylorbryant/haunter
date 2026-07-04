import "@beignet/core/server-only";
import { createDevtoolsProvider } from "@beignet/devtools";
import { createAuthBetterAuthProvider } from "@beignet/provider-auth-better-auth";
import { createDrizzleSqliteProvider } from "@beignet/provider-db-drizzle/sqlite";
import { loggerPinoProvider } from "@beignet/provider-logger-pino";
import { mailResendProvider } from "@beignet/provider-mail-resend";
import * as schema from "@/infra/db/schema";
import { starterDatabaseProvider } from "@/infra/db/provider";
import { vercelBlobStorageProvider } from "@/infra/storage/vercel-blob-storage";
import { auth } from "@/lib/better-auth";
import { env } from "@/lib/env";
import type { AuthSessionMetadata, AuthUser } from "@/ports/auth";
import { createLocalStorageProvider } from "@beignet/provider-storage-local";

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
] as const;

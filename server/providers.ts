import "@beignet/core/server-only";
import { createDevtoolsProvider } from "@beignet/devtools";
import { createAuthBetterAuthProvider } from "@beignet/provider-auth-better-auth";
import { createDrizzleSqliteProvider } from "@beignet/provider-db-drizzle/sqlite";
import { loggerPinoProvider } from "@beignet/provider-logger-pino";
import * as schema from "@/infra/db/schema";
import { starterDatabaseProvider } from "@/infra/db/provider";
import { auth } from "@/lib/better-auth";
import type { AuthSessionMetadata, AuthUser } from "@/ports/auth";
import { createLocalStorageProvider } from "@beignet/provider-storage-local";

const drizzleSqliteProvider = createDrizzleSqliteProvider({ schema });

export const providers = [
	createDevtoolsProvider(),
	createAuthBetterAuthProvider<AuthUser, AuthSessionMetadata>(auth),
	loggerPinoProvider,
	drizzleSqliteProvider,
	starterDatabaseProvider,
	createLocalStorageProvider(),
] as const;

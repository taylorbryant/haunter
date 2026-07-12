import "@beignet/core/server-only";
import { createClient } from "@libsql/client";
import { env } from "@/lib/env";

export const databaseClient = createClient({
	url: env.SQLITE_DB_URL,
	authToken: env.SQLITE_DB_AUTH_TOKEN,
});

let closePromise: Promise<void> | undefined;

export function closeDatabaseClient(): Promise<void> {
	closePromise ??= Promise.resolve().then(() => databaseClient.close());
	return closePromise;
}

import type { Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { env } from "@/lib/env";

let ready: Promise<void> | undefined;

// A local file: database is auto-migrated in development; a remote libsql
// (Turso) database is treated like production — migrated explicitly with
// `beignet db migrate`, never on boot.
const isLocalFile = env.SQLITE_DB_URL.startsWith("file:");

/**
 * Make sure the database is usable before the first query runs.
 *
 * Memoized per process. Next.js collects page data in parallel workers that
 * can all reach this at once, so on a local file database the busy timeout
 * makes concurrent SQLite access wait instead of failing with SQLITE_BUSY.
 * Remote libsql runs over HTTP with no file locking and rejects that PRAGMA,
 * so it is only applied locally.
 */
export function ensureDatabaseReady(client: Client): Promise<void> {
	ready ??= prepare(client);
	return ready;
}

async function prepare(client: Client): Promise<void> {
	if (isLocalFile) {
		await client.execute("PRAGMA busy_timeout = 5000");
	}
	await client.execute("PRAGMA foreign_keys = ON");

	// Never mutate a production or remote database's schema on boot; an
	// unmigrated one fails loudly with the command to run.
	if (!isLocalFile || process.env.NODE_ENV === "production") {
		const tables = await client.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user' LIMIT 1",
		);
		if (tables.rows.length === 0) {
			throw new Error(
				"Database has no tables yet. Run `beignet db migrate` against this database before starting the app.",
			);
		}
		return;
	}

	await migrate(drizzle(client), { migrationsFolder: "drizzle" });
}

import type { Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

let ready: Promise<void> | undefined;

/**
 * Make sure the database is usable before the first query runs.
 *
 * In development, pending migrations from `drizzle/` are applied
 * automatically so a fresh clone works without remembering
 * `beignet db migrate`. In production the schema is never mutated;
 * an unmigrated database fails loudly with the command to run.
 *
 * Memoized per process. Next.js collects page data in parallel workers
 * that can all reach this at once, so the busy timeout makes concurrent
 * SQLite access wait instead of failing with SQLITE_BUSY.
 */
export function ensureDatabaseReady(client: Client): Promise<void> {
	ready ??= prepare(client);
	return ready;
}

async function prepare(client: Client): Promise<void> {
	await client.execute("PRAGMA busy_timeout = 5000");
	await client.execute("PRAGMA foreign_keys = ON");

	if (process.env.NODE_ENV === "production") {
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

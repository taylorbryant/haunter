import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { env } from "@/lib/env";

if (
	!env.SQLITE_DB_URL.startsWith("file:") &&
	process.env.BEIGNET_ALLOW_DATABASE_RESET !== "true"
) {
	throw new Error(
		"Refusing to reset a non-local database. Set BEIGNET_ALLOW_DATABASE_RESET=true if this is intentional.",
	);
}

const tables = [
	"verification",
	"account",
	"session",
	"invitation",
	"member",
	"organization",
	"tasks",
	"canvases",
	"page_links",
	"pages",
	"user",
	"idempotency_records",
	"__drizzle_migrations",
] as const;

const client = createClient({
	url: env.SQLITE_DB_URL,
	authToken: env.SQLITE_DB_AUTH_TOKEN,
});

try {
	await client.execute("PRAGMA foreign_keys = OFF");
	try {
		for (const table of tables) {
			await client.execute(`DROP TABLE IF EXISTS ${table}`);
		}
	} finally {
		await client.execute("PRAGMA foreign_keys = ON");
	}

	await migrate(drizzle(client), { migrationsFolder: "drizzle" });
	console.log("Database reset.");
} finally {
	client.close();
}

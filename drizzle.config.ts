// drizzle-kit runs this config in a plain Node process that does NOT auto-load
// .env files (unlike `bun <file>`), so load .env.local here — otherwise
// SQLITE_DB_URL/token would be missing and migrations would silently target the
// local file: database instead of Turso.
const proc = process as typeof process & {
	loadEnvFile?: (path?: string) => void;
};
try {
	proc.loadEnvFile?.(".env.local");
} catch {
	// No .env.local (or Node < 20.12): use the ambient environment.
}

const url = process.env.SQLITE_DB_URL ?? "file:local.db";
// Surface the target so it's obvious which database is being migrated.
console.error(`[drizzle] target database: ${url}`);

export default {
	schema: "./infra/db/schema/index.ts",
	out: "./drizzle",
	// The Turso dialect uses @libsql/client, which drives both a local
	// file: database and a remote libsql:// (Turso) database with an auth
	// token. Plain "sqlite" only works locally.
	dialect: "turso",
	dbCredentials: {
		url,
		authToken: process.env.SQLITE_DB_AUTH_TOKEN,
	},
};

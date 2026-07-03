import { createClient } from "@libsql/client";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/libsql";
import { ensureDatabaseReady } from "@/infra/db/database-ready";
import * as schema from "@/infra/db/schema";
import { env } from "@/lib/env";

const client = createClient({
	url: env.SQLITE_DB_URL,
	authToken: env.SQLITE_DB_AUTH_TOKEN,
});

// Auth routes can be the first thing to touch the database, before any
// Beignet provider boots, so readiness is enforced here too.
await ensureDatabaseReady(client);

const db = drizzle(client, { schema });

const trustedOrigins = [
	env.APP_URL,
	env.BETTER_AUTH_URL,
	...(env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean) ?? []),
];

export const auth = betterAuth({
	baseURL: env.BETTER_AUTH_URL,
	secret: env.BETTER_AUTH_SECRET,
	trustedOrigins: [...new Set(trustedOrigins)],
	database: drizzleAdapter(db, {
		provider: "sqlite",
		schema,
	}),
	emailAndPassword: {
		enabled: true,
	},
	user: {
		changeEmail: {
			enabled: true,
		},
		deleteUser: {
			enabled: true,
		},
	},
});

import { afterEach, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schemaCheckFor } from "@better-auth/core/db/internal";
import { createClient } from "@libsql/client";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "./schema";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function legacyDatabase() {
	const directory = await mkdtemp(join(tmpdir(), "haunter-account-schema-"));
	const client = createClient({ url: `file:${directory}/test.db` });
	cleanups.push(async () => {
		client.close();
		await rm(directory, { recursive: true, force: true });
	});
	const journal = JSON.parse(
		await readFile("drizzle/meta/_journal.json", "utf8"),
	);
	journal.entries = journal.entries.filter(
		(entry: { idx: number }) => entry.idx < 50,
	);
	const migrationsFolder = join(directory, "drizzle");
	await mkdir(join(migrationsFolder, "meta"), { recursive: true });
	await writeFile(
		join(migrationsFolder, "meta/_journal.json"),
		JSON.stringify(journal),
	);
	for (const entry of journal.entries) {
		await cp(
			`drizzle/${entry.tag}.sql`,
			join(migrationsFolder, `${entry.tag}.sql`),
		);
	}
	const db = drizzle(client, { schema });
	await migrate(db, { migrationsFolder });
	await client.execute("PRAGMA foreign_keys = ON");
	await db.insert(schema.user).values({
		id: "existing-user",
		name: "Existing",
		email: "existing@example.com",
		emailVerified: true,
		createdAt: new Date(1700000000000),
		updatedAt: new Date(1700000000000),
	});
	return { client, db };
}

async function seedAccount(
	client: ReturnType<typeof createClient>,
	id: string,
	issuer: string,
	provider = "credential",
) {
	await client.execute({
		sql: `INSERT INTO account (id, issuer, account_id, provider_id, user_id,
			access_token, refresh_token, id_token, access_token_expires_at,
			refresh_token_expires_at, scope, password, created_at, updated_at)
			VALUES (?, ?, 'existing-user', ?, 'existing-user', 'access', 'refresh',
			'id-token', 1700000000, 1800000000, 'openid', ?, 1600000000, 1650000000)`,
		args: [id, issuer, provider, await hashPassword("existing-password-123")],
	});
}

function authFor(db: ReturnType<typeof drizzle<typeof schema>>) {
	return betterAuth({
		baseURL: "http://localhost:3000",
		secret: "isolated-account-schema-regression-test-secret",
		database: drizzleAdapter(db, { provider: "sqlite", schema }),
		emailAndPassword: { enabled: true },
	});
}

test("account migration preserves legacy data and supports real Better Auth account writes", async () => {
	const { client, db } = await legacyDatabase();
	await seedAccount(client, "legacy-account", "local:credential");
	const before = (await client.execute("SELECT * FROM account")).rows;
	const unrelatedBefore = (
		await client.execute(
			"SELECT type, name, sql FROM sqlite_master WHERE tbl_name != 'account' AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
		)
	).rows;
	await migrate(db, { migrationsFolder: "drizzle" });
	expect((await client.execute("SELECT * FROM account")).rows).toEqual(before);
	expect(
		(
			await client.execute(
				"SELECT type, name, sql FROM sqlite_master WHERE tbl_name != 'account' AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
			)
		).rows,
	).toEqual(unrelatedBefore);
	expect((await client.execute("PRAGMA foreign_key_check")).rows).toEqual([]);
	const auth = authFor(db);
	const context = await auth.$context;
	const check = schemaCheckFor(context.adapter);
	expect(check).toBeDefined();
	await check?.();
	const existing = await auth.api.signInEmail({
		body: { email: "existing@example.com", password: "existing-password-123" },
	});
	expect(existing.user.id).toBe("existing-user");
	const signup = await auth.api.signUpEmail({
		body: {
			name: "New",
			email: "new@example.com",
			password: "new-password-123",
		},
	});
	const created = (
		await client.execute({
			sql: "SELECT issuer, provider_id, account_id FROM account WHERE user_id = ?",
			args: [signup.user.id],
		})
	).rows.map(({ issuer, provider_id, account_id }) => ({
		issuer,
		provider_id,
		account_id,
	}));
	expect(created).toEqual([
		{ issuer: null, provider_id: "credential", account_id: signup.user.id },
	]);
	const signedIn = await auth.api.signInEmail({
		body: { email: "new@example.com", password: "new-password-123" },
	});
	expect(signedIn.user.id).toBe(signup.user.id);
	await expect(
		client.execute(
			"INSERT INTO account (id, account_id, provider_id, user_id, created_at, updated_at) VALUES ('duplicate', 'existing-user', 'credential', 'existing-user', 0, 0)",
		),
	).rejects.toThrow("UNIQUE constraint failed");
	// Equal subjects at different providers remain distinct, including legacy issuers.
	await seedAccount(client, "other-provider", "local:credential", "other");
	await client.execute("DELETE FROM user WHERE id = 'existing-user'");
	expect(
		(
			await client.execute(
				"SELECT id FROM account WHERE user_id = 'existing-user'",
			)
		).rows,
	).toEqual([]);
});

test("ambiguous provider keys abort the migration without losing accounts or recording success", async () => {
	const { client, db } = await legacyDatabase();
	await seedAccount(client, "one", "issuer-one");
	await seedAccount(client, "two", "issuer-two");
	const before = (await client.execute("SELECT * FROM account ORDER BY id"))
		.rows;
	const history = (await client.execute("SELECT * FROM __drizzle_migrations"))
		.rows;
	await expect(migrate(db, { migrationsFolder: "drizzle" })).rejects.toThrow();
	expect(
		(await client.execute("SELECT * FROM account ORDER BY id")).rows,
	).toEqual(before);
	expect(
		(await client.execute("SELECT * FROM __drizzle_migrations")).rows,
	).toEqual(history);
	expect(
		(await client.execute("PRAGMA table_info(account)")).rows.find(
			(row) => row.name === "issuer",
		)?.notnull,
	).toBe(1);
	expect(
		(
			await client.execute(
				"SELECT name FROM sqlite_master WHERE name = '__new_account'",
			)
		).rows,
	).toEqual([]);
});

import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { env } from "@/lib/env";

type AppliedMigration = {
	hash: string;
	createdAt: number;
};

type MigrationJournal = {
	entries: Array<{ tag: string; when: number }>;
};

const databaseFile = sqliteDatabaseFile(env.SQLITE_DB_URL);
const client =
	databaseFile !== undefined && !databaseFileExists(databaseFile)
		? undefined
		: createClient({
				url: env.SQLITE_DB_URL,
				authToken: env.SQLITE_DB_AUTH_TOKEN,
			});

function sqliteDatabaseFile(url: string): string | undefined {
	if (!url.startsWith("file:")) return undefined;
	const rawPath = url.slice("file:".length).split(/[?#]/, 1)[0];
	if (!rawPath || rawPath === ":memory:") return undefined;
	return rawPath.startsWith("//")
		? fileURLToPath(url)
		: path.resolve(decodeURIComponent(rawPath));
}

function databaseFileExists(file: string): boolean {
	try {
		statSync(file);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

try {
	let applied: AppliedMigration[] = [];
	if (client !== undefined) {
		const table = await client.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations' LIMIT 1",
		);
		applied =
			table.rows.length === 0
				? []
				: (
						await client.execute(
							"SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at",
						)
					).rows.map((row) => ({
						hash: String(row.hash),
						createdAt: Number(row.created_at),
					}));
	}
	process.exitCode = await reportMigrationStatus(applied);
} finally {
	client?.close();
}

async function reportMigrationStatus(
	applied: AppliedMigration[],
): Promise<number> {
	const migrationsFolder = "drizzle";
	const journal = JSON.parse(
		await readFile(`${migrationsFolder}/meta/_journal.json`, "utf8"),
	) as MigrationJournal;
	const files = readMigrationFiles({ migrationsFolder });

	if (journal.entries.length !== files.length) {
		console.error(
			`Migration history is invalid: journal has ${journal.entries.length} entries but ${files.length} migration files were read.`,
		);
		return 1;
	}

	const local = files.map((migration, index) => ({
		tag: journal.entries[index]?.tag ?? `migration-${index}`,
		createdAt: migration.folderMillis,
		hash: migration.hash,
	}));
	const localByCreatedAt = new Map(
		local.map((migration) => [migration.createdAt, migration]),
	);
	const appliedByCreatedAt = new Map<number, AppliedMigration>();

	for (const migration of applied) {
		if (appliedByCreatedAt.has(migration.createdAt)) {
			console.error(
				`Migration history has duplicate applied timestamp ${migration.createdAt}.`,
			);
			return 1;
		}
		appliedByCreatedAt.set(migration.createdAt, migration);
		const localMigration = localByCreatedAt.get(migration.createdAt);
		if (!localMigration) {
			console.error(
				`Applied migration ${migration.createdAt} is not present in the checked-in migration journal.`,
			);
			return 1;
		}
		if (localMigration.hash !== migration.hash) {
			console.error(
				`Applied migration ${localMigration.tag} no longer matches its checked-in SQL.`,
			);
			return 1;
		}
	}

	const latestAppliedAt = applied.reduce(
		(latest, migration) => Math.max(latest, migration.createdAt),
		0,
	);
	for (const migration of local) {
		if (
			migration.createdAt <= latestAppliedAt &&
			!appliedByCreatedAt.has(migration.createdAt)
		) {
			console.error(
				`Checked-in migration ${migration.tag} predates the latest applied migration but is absent from database history.`,
			);
			return 1;
		}
	}

	const pending = local.filter(
		(migration) => migration.createdAt > latestAppliedAt,
	);
	if (pending.length > 0) {
		console.error(
			`${pending.length} pending database migration(s):\n${pending
				.map((migration) => `- ${migration.tag}`)
				.join("\n")}`,
		);
		return 2;
	}

	console.log(
		`Database migrations are current (${applied.length} applied, 0 pending).`,
	);
	return 0;
}

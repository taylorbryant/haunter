import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

for (const previousMigration of [51, 52]) {
	test(`canvas projection migration upgrades 00${previousMigration} and preserves drawing data`, async () => {
		const directory = await mkdtemp(
			join(tmpdir(), "haunter-search-migration-"),
		);
		const client = createClient({ url: `file:${directory}/test.db` });
		try {
			const journal = JSON.parse(
				await readFile("drizzle/meta/_journal.json", "utf8"),
			);
			journal.entries = journal.entries.filter(
				(entry: { idx: number }) => entry.idx <= previousMigration,
			);
			const oldMigrations = join(directory, "drizzle");
			await mkdir(join(oldMigrations, "meta"), { recursive: true });
			await writeFile(
				join(oldMigrations, "meta/_journal.json"),
				JSON.stringify(journal),
			);
			for (const entry of journal.entries)
				await cp(
					`drizzle/${entry.tag}.sql`,
					join(oldMigrations, `${entry.tag}.sql`),
				);
			const db = drizzle(client);
			await migrate(db, { migrationsFolder: oldMigrations });
			await client.execute(
				"INSERT INTO user (id,name,email,created_at,updated_at) VALUES ('user','User','user@example.test',1,1)",
			);
			await client.execute(
				"INSERT INTO organization (id,name,slug,created_at) VALUES ('workspace','Workspace','workspace',1)",
			);
			const snapshot = JSON.stringify({
				store: {
					"shape:note": {
						id: "shape:note",
						typeName: "shape",
						type: "note",
						props: { text: "Saved before rollout" },
					},
				},
			});
			await client.execute({
				sql: `INSERT INTO canvases (id,user_id,workspace_id,snapshot,snapshot_updated_at,created_at,updated_at)
    VALUES ('canvas','user','workspace',?,'2026-11-01','2026-10-01','2026-11-01')`,
				args: [snapshot],
			});
			// Reproduce drift from a worker writing after the old triggers were dropped.
			await client.execute("UPDATE canvases SET search_content = '[]'");
			const retained =
				"SELECT snapshot,snapshot_updated_at,created_at,updated_at FROM canvases";
			const before = (await client.execute(retained)).rows;
			await migrate(db, { migrationsFolder: "drizzle" });
			expect((await client.execute(retained)).rows).toEqual(before);
			const row = (
				await client.execute(
					"SELECT search_content,search_projection_version FROM canvases",
				)
			).rows[0];
			expect(JSON.parse(String(row.search_content))).toEqual([
				{ shapeId: "shape:note", text: "Saved before rollout" },
			]);
			expect(row.search_projection_version).toBe(0);
			expect(
				(
					await client.execute(
						"SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='canvases'",
					)
				).rows,
			).toHaveLength(2);
		} finally {
			client.close();
			await rm(directory, { recursive: true, force: true });
		}
	});
}

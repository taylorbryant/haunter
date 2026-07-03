import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Client, createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { createRepositories } from "./repositories";
import * as schema from "./schema";

export type TestDatabase = {
	client: Client;
	db: LibSQLDatabase<typeof schema>;
	repositories: ReturnType<typeof createRepositories>;
	path: string;
	close(): Promise<void>;
};

export async function createTestDatabase(): Promise<TestDatabase> {
	const path = join(tmpdir(), `beignet-test-${crypto.randomUUID()}.db`);
	const client = createClient({ url: `file:${path}` });
	const db = drizzle(client, { schema });
	await migrate(db, { migrationsFolder: "drizzle" });

	return {
		client,
		db,
		repositories: createRepositories(db),
		path,
		close: async () => {
			client.close();
			if (existsSync(path)) {
				unlinkSync(path);
			}
		},
	};
}

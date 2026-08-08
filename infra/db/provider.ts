import "@beignet/core/server-only";
import { createProvider } from "@beignet/core/providers";
import {
	createDrizzleSqliteIdempotencyPort,
	createDrizzleSqliteUnitOfWork,
	type DbPort,
} from "@beignet/provider-db-drizzle/sqlite";
import type { AppPorts } from "@/ports";
import { ensureDatabaseReady } from "./database-ready";
import { createRepositories } from "./repositories";
import type * as schema from "./schema";

export const appDatabaseProvider = createProvider<{
	db: DbPort<typeof schema>;
}>()({
	name: "app-database",

	async setup({ ports }) {
		const dbPort = ports.db;
		if (!dbPort) {
			throw new Error(
				"appDatabaseProvider requires a db port. Register createDrizzleSqliteProvider({ schema }) before it.",
			);
		}

		const repositories = createRepositories(dbPort.drizzle);
		const idempotency = createDrizzleSqliteIdempotencyPort(dbPort.drizzle);

		const providedPorts: Pick<
			AppPorts,
			| "canvases"
			| "changelogState"
			| "idempotency"
			| "members"
			| "mcpOAuthClients"
			| "notificationInbox"
			| "pageLinks"
			| "pages"
			| "pageVersions"
			| "pageTaskProjection"
			| "shares"
			| "tasks"
			| "taskSourceDocuments"
			| "uow"
		> = {
			...repositories,
			idempotency,
			uow: createDrizzleSqliteUnitOfWork({
				db: dbPort.drizzle,
				createTransactionPorts: (tx) => ({
					...createRepositories(tx),
					idempotency: createDrizzleSqliteIdempotencyPort(tx),
				}),
			}),
		};

		return {
			ports: providedPorts,
			async start() {
				await ensureDatabaseReady(dbPort.client);
			},
		};
	},
});

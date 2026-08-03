import "@beignet/core/server-only";
import { createProvider } from "@beignet/core/providers";
import {
	createDrizzleSqliteIdempotencyPort,
	createDrizzleSqliteOutboxAdminPort,
	createDrizzleSqliteOutboxPort,
	createDrizzleSqliteUnitOfWork,
	type DbPort,
} from "@beignet/provider-db-drizzle/sqlite";
import type { AppPorts } from "@/ports";
import { ensureDatabaseReady } from "./database-ready";
import { createRepositories } from "./repositories";
import type * as schema from "./schema";

export const starterDatabaseProvider = createProvider<{
	db: DbPort<typeof schema>;
}>()({
	name: "starter-database",

	async setup({ ports }) {
		const dbPort = ports.db;
		if (!dbPort) {
			throw new Error(
				"starterDatabaseProvider requires a db port. Register createDrizzleSqliteProvider({ schema }) before it.",
			);
		}

		const repositories = createRepositories(dbPort.drizzle);
		const idempotency = createDrizzleSqliteIdempotencyPort(dbPort.drizzle);
		const outbox = createDrizzleSqliteOutboxPort(dbPort.drizzle);
		const outboxAdmin = createDrizzleSqliteOutboxAdminPort(dbPort.drizzle);

		const providedPorts: Pick<
			AppPorts,
			| "canvases"
			| "changelogState"
			| "documents"
			| "idempotency"
			| "members"
			| "mcpOAuthClients"
			| "notificationInbox"
			| "outbox"
			| "outboxAdmin"
			| "pageLinks"
			| "pages"
			| "pageVersions"
			| "shares"
			| "tasks"
			| "uow"
		> = {
			...repositories,
			idempotency,
			outbox,
			outboxAdmin,
			uow: createDrizzleSqliteUnitOfWork({
				db: dbPort.drizzle,
				createTransactionPorts: (tx) => ({
					...createRepositories(tx),
					idempotency: createDrizzleSqliteIdempotencyPort(tx),
					outbox: createDrizzleSqliteOutboxPort(tx),
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

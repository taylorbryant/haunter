import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { createDrizzleCanvasRepository } from "@/infra/canvases/drizzle-canvas-repository";
import { createDrizzlePageLinkRepository } from "@/infra/pages/drizzle-page-link-repository";
import { createDrizzlePageRepository } from "@/infra/pages/drizzle-page-repository";
import { createDrizzleTaskRepository } from "@/infra/tasks/drizzle-task-repository";
import { createDrizzleWorkspaceRepository } from "@/infra/workspaces/drizzle-workspace-repository";
import type { AppTransactionPorts } from "@/ports";
import type * as schema from "./schema";

export function createRepositories(
	db: DrizzleSqliteDatabase<typeof schema>,
): Omit<AppTransactionPorts, "idempotency"> {
	return {
		canvases: createDrizzleCanvasRepository(db),
		pageLinks: createDrizzlePageLinkRepository(db),
		pages: createDrizzlePageRepository(db),
		tasks: createDrizzleTaskRepository(db),
		workspaces: createDrizzleWorkspaceRepository(db),
	};
}

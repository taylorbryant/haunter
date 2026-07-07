import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { createDrizzleAgentAdminRepository } from "@/infra/agents/drizzle-agent-admin-repository";
import { createDrizzleCanvasRepository } from "@/infra/canvases/drizzle-canvas-repository";
import { createDrizzleMemberRepository } from "@/infra/members/drizzle-member-repository";
import { createDrizzlePageLinkRepository } from "@/infra/pages/drizzle-page-link-repository";
import { createDrizzlePageRepository } from "@/infra/pages/drizzle-page-repository";
import { createDrizzlePageVersionRepository } from "@/infra/pages/drizzle-page-version-repository";
import { createDrizzleShareRepository } from "@/infra/shares/drizzle-share-repository";
import { createDrizzleTaskRepository } from "@/infra/tasks/drizzle-task-repository";
import { createDrizzleWaitlistRepository } from "@/infra/waitlist/drizzle-waitlist-repository";
import type { AppTransactionPorts } from "@/ports";
import type * as schema from "./schema";

export function createRepositories(
	db: DrizzleSqliteDatabase<typeof schema>,
): Omit<AppTransactionPorts, "idempotency"> {
	return {
		agents: createDrizzleAgentAdminRepository(db),
		canvases: createDrizzleCanvasRepository(db),
		members: createDrizzleMemberRepository(db),
		pageLinks: createDrizzlePageLinkRepository(db),
		pages: createDrizzlePageRepository(db),
		pageVersions: createDrizzlePageVersionRepository(db),
		shares: createDrizzleShareRepository(db),
		tasks: createDrizzleTaskRepository(db),
		waitlist: createDrizzleWaitlistRepository(db),
	};
}

import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { createDrizzleAdminUserRepository } from "@/infra/admin/drizzle-admin-user-repository";
import { createDrizzleAgentAdminRepository } from "@/infra/agents/drizzle-agent-admin-repository";
import { createDrizzleCanvasRepository } from "@/infra/canvases/drizzle-canvas-repository";
import { createDrizzleChangelogStateRepository } from "@/infra/changelog/drizzle-changelog-state-repository";
import { createDrizzleMemberRepository } from "@/infra/members/drizzle-member-repository";
import { createDrizzleNotificationRepository } from "@/infra/notifications/drizzle-notification-repository";
import { createDrizzlePageLinkRepository } from "@/infra/pages/drizzle-page-link-repository";
import { createDrizzlePageNavigationRepository } from "@/infra/pages/drizzle-page-navigation-repository";
import { createDrizzlePageRepository } from "@/infra/pages/drizzle-page-repository";
import { createDrizzlePageVersionRepository } from "@/infra/pages/drizzle-page-version-repository";
import { createDrizzleShareRepository } from "@/infra/shares/drizzle-share-repository";
import { createDrizzleTaskRepository } from "@/infra/tasks/drizzle-task-repository";
import type { AppTransactionPorts } from "@/ports";
import type * as schema from "./schema";

export function createRepositories(
	db: DrizzleSqliteDatabase<typeof schema>,
): Omit<AppTransactionPorts, "idempotency"> {
	return {
		adminUsers: createDrizzleAdminUserRepository(db),
		agents: createDrizzleAgentAdminRepository(db),
		canvases: createDrizzleCanvasRepository(db),
		changelogState: createDrizzleChangelogStateRepository(db),
		members: createDrizzleMemberRepository(db),
		notificationInbox: createDrizzleNotificationRepository(db),
		pageLinks: createDrizzlePageLinkRepository(db),
		pageNavigation: createDrizzlePageNavigationRepository(db),
		pages: createDrizzlePageRepository(db),
		pageVersions: createDrizzlePageVersionRepository(db),
		shares: createDrizzleShareRepository(db),
		tasks: createDrizzleTaskRepository(db),
	};
}

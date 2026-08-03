import "@beignet/core/server-only";
import { contractsFromRoutes, defineRoutes } from "@beignet/core/server";
import type { AppContext } from "@/app-context";
import { adminRoutes } from "@/features/admin/routes";
import { agentRoutes } from "@/features/agents/routes";
import { canvasRoutes } from "@/features/canvases/routes";
import { changelogRoutes } from "@/features/changelog/routes";
import { documentRoutes } from "@/features/documents/routes";
import { notificationRoutes } from "@/features/notifications/routes";
import { pageRoutes } from "@/features/pages/routes";
import { shareRoutes } from "@/features/shares/routes";
import { taskRoutes } from "@/features/tasks/routes";
import { workspaceRoutes } from "@/features/workspaces/routes";

export const routes = defineRoutes<AppContext>([
	adminRoutes,
	agentRoutes,
	workspaceRoutes,
	changelogRoutes,
	documentRoutes,
	pageRoutes,
	shareRoutes,
	taskRoutes,
	notificationRoutes,
	canvasRoutes,
]);
export const contracts = contractsFromRoutes(routes);

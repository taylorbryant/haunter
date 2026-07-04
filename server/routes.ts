import "@beignet/core/server-only";
import { contractsFromRoutes, defineRoutes } from "@beignet/next";
import type { AppContext } from "@/app-context";
import { canvasRoutes } from "@/features/canvases/routes";
import { pageRoutes } from "@/features/pages/routes";
import { shareRoutes } from "@/features/shares/routes";
import { taskRoutes } from "@/features/tasks/routes";
import { workspaceRoutes } from "@/features/workspaces/routes";

export const routes = defineRoutes<AppContext>([
	workspaceRoutes,
	pageRoutes,
	shareRoutes,
	taskRoutes,
	canvasRoutes,
]);
export const contracts = contractsFromRoutes(routes);

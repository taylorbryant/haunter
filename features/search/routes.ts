import "@beignet/core/server-only";
import { defineRouteGroup } from "@/lib/routes";
import { routeAuth } from "@/lib/route-auth";
import { searchWorkspace } from "./contracts";
import { searchWorkspaceUseCase } from "./use-cases";

export const searchRoutes = defineRouteGroup({
	name: "search",
	hooks: [routeAuth.required()],
	routes: [{ contract: searchWorkspace, useCase: searchWorkspaceUseCase }],
});

import "@beignet/core/server-only";
import { defineRouteGroup } from "@/lib/routes";
import { routeAuth } from "@/lib/route-auth";
import { listWorkspaceMembers } from "./contracts";
import { listWorkspaceMembersUseCase } from "./use-cases";

export const memberRoutes = defineRouteGroup({
	name: "members",
	hooks: [routeAuth.required()],
	routes: [
		{ contract: listWorkspaceMembers, useCase: listWorkspaceMembersUseCase },
	],
});

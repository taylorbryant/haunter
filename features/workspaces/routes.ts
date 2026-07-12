import "@beignet/core/server-only";
import { onboard } from "@/features/workspaces/contracts";
import { onboardUserUseCase } from "@/features/workspaces/use-cases";
import { defineRouteGroup } from "@/lib/routes";
import { routeAuth } from "@/server/auth-hooks";

export const workspaceRoutes = defineRouteGroup({
	name: "workspaces",
	hooks: [routeAuth.required()],
	routes: [{ contract: onboard, useCase: onboardUserUseCase }],
});

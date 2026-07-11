import "@beignet/core/server-only";
import { defineRouteGroup } from "@beignet/core/server";
import type { AppContext } from "@/app-context";
import { onboard } from "@/features/workspaces/contracts";
import { onboardUserUseCase } from "@/features/workspaces/use-cases";
import { routeAuth } from "@/server/auth-hooks";

export const workspaceRoutes = defineRouteGroup<AppContext>()({
	name: "workspaces",
	hooks: [routeAuth.required()],
	routes: [{ contract: onboard, useCase: onboardUserUseCase }],
});

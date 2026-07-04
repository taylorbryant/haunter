import "@beignet/core/server-only";
import { defineRouteGroup } from "@beignet/next";
import type { AppContext } from "@/app-context";
import { onboard } from "@/features/workspaces/contracts";
import { onboardUserUseCase } from "@/features/workspaces/use-cases";

export const workspaceRoutes = defineRouteGroup<AppContext>()({
	name: "workspaces",
	routes: [{ contract: onboard, useCase: onboardUserUseCase }],
});

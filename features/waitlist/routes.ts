import "@beignet/core/server-only";
import { defineRouteGroup } from "@beignet/next";
import type { AppContext } from "@/app-context";
import { requestAccess } from "@/features/waitlist/contracts";
import { requestAccessUseCase } from "@/features/waitlist/use-cases";

export const waitlistRoutes = defineRouteGroup<AppContext>()({
	name: "waitlist",
	routes: [{ contract: requestAccess, useCase: requestAccessUseCase }],
});


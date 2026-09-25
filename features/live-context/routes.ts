import "@beignet/core/server-only";
import { defineRouteGroup } from "@/lib/routes";
import { routeAuth } from "@/lib/route-auth";
import { publishLiveContext } from "./contracts";
import { publishLiveContextUseCase } from "./use-cases";

export const liveContextRoutes = defineRouteGroup({
	name: "live-context",
	hooks: [routeAuth.required()],
	routes: [
		{ contract: publishLiveContext, useCase: publishLiveContextUseCase },
	],
});

import "@beignet/core/server-only";
import { defineRouteGroup } from "@beignet/core/server";
import type { AppContext } from "@/app-context";
import { approveWaitlistUser, listWaitlist } from "@/features/admin/contracts";
import {
	approveWaitlistUserUseCase,
	listWaitlistUseCase,
} from "@/features/admin/use-cases";
import { routeAuth } from "@/server/auth-hooks";

export const adminRoutes = defineRouteGroup<AppContext>()({
	name: "admin",
	hooks: [routeAuth.required()],
	routes: [
		{ contract: listWaitlist, useCase: listWaitlistUseCase },
		{ contract: approveWaitlistUser, useCase: approveWaitlistUserUseCase },
	],
});

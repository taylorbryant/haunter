import "@beignet/core/server-only";
import { approveWaitlistUser, listWaitlist } from "@/features/admin/contracts";
import {
	approveWaitlistUserUseCase,
	listWaitlistUseCase,
} from "@/features/admin/use-cases";
import { defineRouteGroup } from "@/lib/routes";
import { routeAuth } from "@/lib/route-auth";

export const adminRoutes = defineRouteGroup({
	name: "admin",
	hooks: [routeAuth.required()],
	routes: [
		{ contract: listWaitlist, useCase: listWaitlistUseCase },
		{ contract: approveWaitlistUser, useCase: approveWaitlistUserUseCase },
	],
});

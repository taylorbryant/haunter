import "@beignet/core/server-only";
import { defineRouteGroup } from "@beignet/next";
import type { AppContext } from "@/app-context";
import { approveWaitlistUser, listWaitlist } from "@/features/admin/contracts";
import {
	approveWaitlistUserUseCase,
	listWaitlistUseCase,
} from "@/features/admin/use-cases";

export const adminRoutes = defineRouteGroup<AppContext>()({
	name: "admin",
	routes: [
		{ contract: listWaitlist, useCase: listWaitlistUseCase },
		{ contract: approveWaitlistUser, useCase: approveWaitlistUserUseCase },
	],
});

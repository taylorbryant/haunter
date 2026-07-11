import "@beignet/core/server-only";
import { defineRouteGroup } from "@beignet/core/server";
import type { AppContext } from "@/app-context";
import {
	createPageShare,
	getPageShare,
	getSharedCanvas,
	getSharedPage,
	revokePageShare,
} from "@/features/shares/contracts";
import {
	createPageShareUseCase,
	getPageShareUseCase,
	getSharedCanvasUseCase,
	getSharedPageUseCase,
	revokePageShareUseCase,
} from "@/features/shares/use-cases";
import { routeAuth } from "@/server/auth-hooks";

export const shareRoutes = defineRouteGroup<AppContext>()({
	name: "shares",
	routes: [
		{
			contract: getPageShare,
			hooks: [routeAuth.required()],
			useCase: getPageShareUseCase,
		},
		{
			contract: createPageShare,
			hooks: [routeAuth.required()],
			useCase: createPageShareUseCase,
		},
		{
			contract: revokePageShare,
			hooks: [routeAuth.required()],
			useCase: revokePageShareUseCase,
		},
		{ contract: getSharedPage, useCase: getSharedPageUseCase },
		{ contract: getSharedCanvas, useCase: getSharedCanvasUseCase },
	],
});

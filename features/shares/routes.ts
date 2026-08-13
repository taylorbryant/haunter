import "@beignet/core/server-only";
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
import { defineRouteGroup } from "@/lib/routes";
import { routeAuth } from "@/server/auth-hooks";

export const shareRoutes = defineRouteGroup({
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

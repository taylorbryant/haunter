import "@beignet/core/server-only";
import { defineRouteGroup } from "@beignet/next";
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

export const shareRoutes = defineRouteGroup<AppContext>()({
	name: "shares",
	routes: [
		{ contract: getPageShare, useCase: getPageShareUseCase },
		{ contract: createPageShare, useCase: createPageShareUseCase },
		{ contract: revokePageShare, useCase: revokePageShareUseCase },
		{ contract: getSharedPage, useCase: getSharedPageUseCase },
		{ contract: getSharedCanvas, useCase: getSharedCanvasUseCase },
	],
});

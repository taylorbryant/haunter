import "@beignet/core/server-only";
import type { ServerHook } from "@beignet/core/server";
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
import { defineRouteGroup } from "@/lib/routes";
import { routeAuth } from "@/lib/route-auth";

/** Current page references authorize each read, including after removal/restoration. */
export const sharedCanvasResponseHooks: ServerHook<AppContext> = {
	name: "shared-canvas-response",
	beforeSend({ contract, response }) {
		if (contract.name !== getSharedCanvas.name) return;
		return {
			...response,
			headers: { ...response.headers, "Cache-Control": "no-store" },
		};
	},
};

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

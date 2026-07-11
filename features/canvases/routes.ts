import "@beignet/core/server-only";
import { defineRouteGroup } from "@beignet/core/server";
import type { AppContext } from "@/app-context";
import {
	createCanvas,
	getCanvas,
	saveCanvasSnapshot,
} from "@/features/canvases/contracts";
import {
	createCanvasUseCase,
	getCanvasUseCase,
	saveCanvasSnapshotUseCase,
} from "@/features/canvases/use-cases";
import { routeAuth } from "@/server/auth-hooks";

export const canvasRoutes = defineRouteGroup<AppContext>()({
	name: "canvases",
	hooks: [routeAuth.required()],
	routes: [
		{ contract: createCanvas, useCase: createCanvasUseCase },
		{ contract: getCanvas, useCase: getCanvasUseCase },
		{ contract: saveCanvasSnapshot, useCase: saveCanvasSnapshotUseCase },
	],
});

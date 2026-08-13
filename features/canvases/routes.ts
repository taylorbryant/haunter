import "@beignet/core/server-only";
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
import { defineRouteGroup } from "@/lib/routes";
import { routeAuth } from "@/lib/route-auth";

export const canvasRoutes = defineRouteGroup({
	name: "canvases",
	hooks: [routeAuth.required()],
	routes: [
		{ contract: createCanvas, useCase: createCanvasUseCase },
		{ contract: getCanvas, useCase: getCanvasUseCase },
		{ contract: saveCanvasSnapshot, useCase: saveCanvasSnapshotUseCase },
	],
});

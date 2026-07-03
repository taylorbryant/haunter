import "@beignet/core/server-only";
import { defineRouteGroup } from "@beignet/next";
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

export const canvasRoutes = defineRouteGroup<AppContext>()({
	name: "canvases",
	routes: [
		{ contract: createCanvas, useCase: createCanvasUseCase },
		{ contract: getCanvas, useCase: getCanvasUseCase },
		{ contract: saveCanvasSnapshot, useCase: saveCanvasSnapshotUseCase },
	],
});

import "@beignet/core/server-only";
import {
	createCanvas,
	deleteCanvas,
	getCanvas,
	getCanvasNavigation,
	listCanvases,
	recordCanvasView,
	saveCanvasSnapshot,
	setCanvasFavorite,
	updateCanvas,
} from "@/features/canvases/contracts";
import {
	createCanvasUseCase,
	deleteCanvasUseCase,
	getCanvasNavigationUseCase,
	getCanvasUseCase,
	listCanvasesUseCase,
	recordCanvasViewUseCase,
	saveCanvasSnapshotUseCase,
	setCanvasFavoriteUseCase,
	updateCanvasUseCase,
} from "@/features/canvases/use-cases";
import { routeAuth } from "@/lib/route-auth";
import { defineRouteGroup } from "@/lib/routes";

export const canvasRoutes = defineRouteGroup({
	name: "canvases",
	hooks: [routeAuth.required()],
	routes: [
		{ contract: createCanvas, useCase: createCanvasUseCase },
		{ contract: listCanvases, useCase: listCanvasesUseCase },
		{ contract: getCanvasNavigation, useCase: getCanvasNavigationUseCase },
		{ contract: setCanvasFavorite, useCase: setCanvasFavoriteUseCase },
		{ contract: recordCanvasView, useCase: recordCanvasViewUseCase },
		{ contract: getCanvas, useCase: getCanvasUseCase },
		{ contract: saveCanvasSnapshot, useCase: saveCanvasSnapshotUseCase },
		{ contract: updateCanvas, useCase: updateCanvasUseCase },
		{ contract: deleteCanvas, useCase: deleteCanvasUseCase },
	],
});

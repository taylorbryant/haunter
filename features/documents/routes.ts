import "@beignet/core/server-only";
import { defineRouteGroup } from "@/lib/routes";
import { routeAuth } from "@/lib/route-auth";
import {
	openDocumentSession,
	openCanvasSession,
	importRecovery,
} from "./contracts";
import { importRecoveryUseCase } from "./use-cases/import-recovery";
import { openDocumentSessionUseCase } from "./use-cases/open-document-session";

import { openCanvasSessionUseCase } from "./use-cases/open-canvas-session";

export const documentRoutes = defineRouteGroup({
	name: "documents",
	hooks: [routeAuth.required()],
	routes: [
		{ contract: openCanvasSession, useCase: openCanvasSessionUseCase },
		{ contract: importRecovery, useCase: importRecoveryUseCase },
		{ contract: openDocumentSession, useCase: openDocumentSessionUseCase },
	],
});

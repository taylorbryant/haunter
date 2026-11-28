import "@beignet/core/server-only";
import { defineRouteGroup } from "@/lib/routes";
import { routeAuth } from "@/lib/route-auth";
import {
	openDocumentSession,
	openCanvasSession,
	importRecovery,
	stageRecoveryPart,
} from "./contracts";
import { stageRecoveryPartUseCase } from "./use-cases/stage-recovery-part";
import { importRecoveryUseCase } from "./use-cases/import-recovery";
import { openDocumentSessionUseCase } from "./use-cases/open-document-session";

import { openCanvasSessionUseCase } from "./use-cases/open-canvas-session";

export const documentRoutes = defineRouteGroup({
	name: "documents",
	hooks: [routeAuth.required()],
	routes: [
		{ contract: openCanvasSession, useCase: openCanvasSessionUseCase },
		{ contract: stageRecoveryPart, useCase: stageRecoveryPartUseCase },
		{ contract: importRecovery, useCase: importRecoveryUseCase },
		{ contract: openDocumentSession, useCase: openDocumentSessionUseCase },
	],
});

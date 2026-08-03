import "@beignet/core/server-only";
import { defineRouteGroup } from "@/lib/routes";
import { routeAuth } from "@/server/auth-hooks";
import { queueDocumentMaterialization } from "./contracts";
import { queueDocumentMaterializationUseCase } from "./use-cases";

export const documentRoutes = defineRouteGroup({
	name: "documents",
	hooks: [routeAuth.required()],
	routes: [
		{
			contract: queueDocumentMaterialization,
			useCase: queueDocumentMaterializationUseCase,
		},
	],
});

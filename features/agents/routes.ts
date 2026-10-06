import {
	exchangeEmbeddedEditor,
	verifyEmbeddedEditor,
	listEmbeddedWorkspaces,
	getEmbeddedAppearance,
	updateEmbeddedAppearance,
} from "./contracts";
import {
	getEmbeddedAppearanceUseCase,
	updateEmbeddedAppearanceUseCase,
} from "./use-cases/embedded-appearance";
import {
	exchangeEmbeddedEditorUseCase,
	verifyEmbeddedEditorUseCase,
	listEmbeddedWorkspacesUseCase,
} from "./use-cases/embedded-editor-session";
import "@beignet/core/server-only";
import {
	authorizeMcpConnection,
	disconnectMcpConnection,
	getMcpConsentContext,
	getPendingAgent,
	listAgentActivity,
	listAgents,
} from "@/features/agents/contracts";
import {
	authorizeMcpConnectionUseCase,
	disconnectMcpConnectionUseCase,
	getMcpConsentContextUseCase,
	getPendingAgentUseCase,
	listAgentActivityUseCase,
	listAgentsUseCase,
} from "@/features/agents/use-cases";
import { defineRouteGroup } from "@/lib/routes";
import { routeAuth } from "@/lib/route-auth";

export const agentRoutes = defineRouteGroup({
	name: "agents",
	hooks: [routeAuth.required()],
	routes: [
		{ contract: listAgents, useCase: listAgentsUseCase },
		{ contract: listAgentActivity, useCase: listAgentActivityUseCase },
		{ contract: getPendingAgent, useCase: getPendingAgentUseCase },
		{
			contract: getMcpConsentContext,
			useCase: getMcpConsentContextUseCase,
		},
		{
			contract: authorizeMcpConnection,
			useCase: authorizeMcpConnectionUseCase,
		},
		{
			contract: disconnectMcpConnection,
			useCase: disconnectMcpConnectionUseCase,
		},
	],
});

export const embeddedEditorRoutes = defineRouteGroup({
	name: "embeddedEditor",
	routes: [
		{ contract: getEmbeddedAppearance, useCase: getEmbeddedAppearanceUseCase },
		{
			contract: updateEmbeddedAppearance,
			useCase: updateEmbeddedAppearanceUseCase,
		},
		{
			contract: exchangeEmbeddedEditor,
			useCase: exchangeEmbeddedEditorUseCase,
		},
		{ contract: verifyEmbeddedEditor, useCase: verifyEmbeddedEditorUseCase },
		{
			contract: listEmbeddedWorkspaces,
			useCase: listEmbeddedWorkspacesUseCase,
		},
	],
});

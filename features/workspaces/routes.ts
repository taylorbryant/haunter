import "@beignet/core/server-only";
import { defineRouteGroup } from "@beignet/next";
import type { AppContext } from "@/app-context";
import {
	createWorkspace,
	deleteWorkspace,
	listWorkspaces,
	updateWorkspace,
} from "@/features/workspaces/contracts";
import {
	createWorkspaceUseCase,
	deleteWorkspaceUseCase,
	listWorkspacesUseCase,
	updateWorkspaceUseCase,
} from "@/features/workspaces/use-cases";

export const workspaceRoutes = defineRouteGroup<AppContext>()({
	name: "workspaces",
	routes: [
		{ contract: listWorkspaces, useCase: listWorkspacesUseCase },
		{ contract: createWorkspace, useCase: createWorkspaceUseCase },
		{ contract: updateWorkspace, useCase: updateWorkspaceUseCase },
		{ contract: deleteWorkspace, useCase: deleteWorkspaceUseCase },
	],
});

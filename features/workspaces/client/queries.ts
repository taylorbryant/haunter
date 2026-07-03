import type { QueryClient } from "@tanstack/react-query";
import { rq } from "@/client";
import {
	createWorkspace,
	deleteWorkspace,
	listWorkspaces,
	updateWorkspace,
} from "@/features/workspaces/contracts";

export function listWorkspacesQueryOptions() {
	return rq(listWorkspaces).queryOptions();
}

export function createWorkspaceMutationOptions() {
	return rq(createWorkspace).mutationOptions();
}

export function updateWorkspaceMutationOptions() {
	return rq(updateWorkspace).mutationOptions();
}

export function deleteWorkspaceMutationOptions() {
	return rq(deleteWorkspace).mutationOptions();
}

export function invalidateWorkspaces(queryClient: QueryClient) {
	return rq(listWorkspaces).invalidate(queryClient);
}

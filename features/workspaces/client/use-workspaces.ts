"use client";

import { authClient } from "@/client/auth-client";

export type WorkspaceSummary = {
	id: string;
	name: string;
	logo: string | null;
};

export function useWorkspaces() {
	const query = authClient.useListOrganizations();
	const workspaces: WorkspaceSummary[] =
		query.data?.map((workspace) => ({
			id: workspace.id,
			name: workspace.name,
			logo: workspace.logo ?? null,
		})) ?? [];

	return {
		...query,
		workspaces,
	};
}

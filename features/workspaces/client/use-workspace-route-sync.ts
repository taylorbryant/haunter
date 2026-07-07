"use client";

import { useEffect } from "react";
import { authClient } from "@/client/auth-client";
import { useActiveWorkspaceHint } from "@/components/active-workspace-provider";

export function useWorkspaceRouteSync(
	workspaceId: string | null,
	options: { syncActive?: boolean } = {},
) {
	const serverHint = useActiveWorkspaceHint();
	const activeQuery = authClient.useActiveOrganization();
	const activeId = activeQuery.data?.id ?? null;
	const synced =
		workspaceId !== null &&
		(activeQuery.isPending ? serverHint === workspaceId : activeId === workspaceId);

	useEffect(() => {
		if (
			options.syncActive !== true ||
			workspaceId === null ||
			activeQuery.isPending ||
			activeId === workspaceId
		) {
			return;
		}

		void authClient.organization.setActive({ organizationId: workspaceId });
	}, [options.syncActive, activeQuery.isPending, activeId, workspaceId]);

	return { synced };
}

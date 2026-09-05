"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient } from "@/client/auth-client";
import { reportAuthError } from "@/client/error-feedback";
import { useAppSession } from "@/components/app-session-provider";

export function useWorkspaceRouteSync(
	workspaceId: string | null,
	options: { syncActive?: boolean } = {},
) {
	const router = useRouter();
	const activeId = useAppSession()?.activeWorkspaceId ?? null;
	const [pendingWorkspaceId, setPendingWorkspaceId] = useState<string | null>(
		null,
	);
	const synced = workspaceId !== null && activeId === workspaceId;

	useEffect(() => {
		if (pendingWorkspaceId !== null && activeId === pendingWorkspaceId) {
			setPendingWorkspaceId(null);
		}
	}, [activeId, pendingWorkspaceId]);

	useEffect(() => {
		if (
			options.syncActive !== true ||
			workspaceId === null ||
			activeId === workspaceId ||
			pendingWorkspaceId === workspaceId
		) {
			return;
		}

		setPendingWorkspaceId(workspaceId);
		void (async () => {
			try {
				const result = await authClient.organization.setActive({
					organizationId: workspaceId,
				});
				if (result.error) throw result.error;
				router.refresh();
			} catch (error) {
				setPendingWorkspaceId(null);
				reportAuthError(error, "The workspace could not be activated.");
			}
		})();
	}, [options.syncActive, activeId, pendingWorkspaceId, workspaceId, router]);

	return { synced };
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient } from "@/client/auth-client";
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
		void authClient.organization
			.setActive({ organizationId: workspaceId })
			.then(() => router.refresh())
			.catch(() => setPendingWorkspaceId(null));
	}, [options.syncActive, activeId, pendingWorkspaceId, workspaceId, router]);

	return { synced };
}

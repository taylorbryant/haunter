"use client";

import { useDraftSafeRouter as useRouter } from "@/client/use-draft-safe-router";
import { useEffect, useRef, useState } from "react";
import { useProtectedRequestsEnabled } from "@/components/session-recovery-provider";
import { authClient } from "@/client/auth-client";
import { getBrowserSessionRecovery } from "@/client/session-recovery";
import { authErrorMessage, reportUserError } from "@/client/error-feedback";
import { useAppSession } from "@/components/app-session-provider";

export function useWorkspaceRouteSync(
	workspaceId: string | null,
	options: { syncActive?: boolean } = {},
) {
	const router = useRouter();
	const requestsEnabled = useProtectedRequestsEnabled();
	const activeId = useAppSession()?.activeWorkspaceId ?? null;
	const [pendingWorkspaceId, setPendingWorkspaceId] = useState<string | null>(
		null,
	);
	const [failure, setFailure] = useState<{
		workspaceId: string;
		message: string;
	} | null>(null);
	const inFlight = useRef<string | null>(null);
	const synced = workspaceId !== null && activeId === workspaceId;

	useEffect(() => {
		if (!requestsEnabled) setPendingWorkspaceId(null);
	}, [requestsEnabled]);

	useEffect(() => {
		if (pendingWorkspaceId !== null && activeId === pendingWorkspaceId) {
			setPendingWorkspaceId(null);
		}
	}, [activeId, pendingWorkspaceId]);

	useEffect(() => {
		if (
			!requestsEnabled ||
			options.syncActive !== true ||
			workspaceId === null ||
			activeId === workspaceId ||
			pendingWorkspaceId === workspaceId ||
			inFlight.current === workspaceId ||
			failure?.workspaceId === workspaceId
		) {
			return;
		}

		setPendingWorkspaceId(workspaceId);
		inFlight.current = workspaceId;
		const recovery = getBrowserSessionRecovery();
		const epoch = recovery?.epoch;
		void (async () => {
			try {
				const result = await authClient.organization.setActive({
					organizationId: workspaceId,
				});
				if (result.error) throw result.error;
				if (
					recovery &&
					(recovery.epoch !== epoch || recovery.getSnapshot().blocked)
				)
					return;
				router.refresh();
			} catch (error) {
				setPendingWorkspaceId(null);
				if (
					recovery &&
					(recovery.epoch !== epoch || recovery.getSnapshot().blocked)
				)
					return;
				reportUserError(
					authErrorMessage(error, "The workspace could not be activated."),
				);
				setFailure({
					workspaceId,
					message: authErrorMessage(
						error,
						"The workspace could not be opened.",
					),
				});
			} finally {
				if (inFlight.current === workspaceId) inFlight.current = null;
			}
		})();
	}, [
		requestsEnabled,
		options.syncActive,
		activeId,
		pendingWorkspaceId,
		failure,
		workspaceId,
		router,
	]);

	return {
		synced,
		error: failure?.workspaceId === workspaceId ? failure.message : null,
		retry: () => {
			setFailure(null);
			setPendingWorkspaceId(null);
		},
	};
}

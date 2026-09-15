"use client";

import { BroadcastClientError } from "@beignet/core/broadcasting/client";
import { useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { createAppBroadcastClient } from "@/client/broadcasts";
import { getBrowserSessionRecovery } from "@/client/session-recovery";
import { useDraftSafeRouter } from "@/client/use-draft-safe-router";
import { useCurrentUser } from "@/components/app-session-provider";
import { useProtectedRequestsEnabled } from "@/components/session-recovery-provider";
import { subscribeToWorkspaceChanges } from "./broadcasts";

const liveUpdatesEnabled = process.env.NEXT_PUBLIC_LIVE_UPDATES === "true";

export function WorkspaceEventSubscriber({
	workspaceId,
}: {
	workspaceId: string;
}) {
	const queryClient = useQueryClient();
	const requestsEnabled = useProtectedRequestsEnabled();
	const currentUserId = useCurrentUser()?.id;
	const router = useDraftSafeRouter();
	const params = useParams<{ pageId?: string | string[] }>();
	const activePageIdRef = useRef<string | undefined>(undefined);
	activePageIdRef.current = Array.isArray(params.pageId)
		? params.pageId[0]
		: params.pageId;
	useEffect(() => {
		if (!requestsEnabled || !currentUserId || !liveUpdatesEnabled) return;
		const client = createAppBroadcastClient();
		const recovery = getBrowserSessionRecovery();
		const epoch = recovery?.epoch;
		const unsubscribe = subscribeToWorkspaceChanges({
			client,
			queryClient,
			workspaceId,
			getCurrentPageId: () => activePageIdRef.current,
			onPageRemoved(pageId) {
				if (activePageIdRef.current === pageId)
					router.replace(`/w/${workspaceId}/home`);
			},
			onError(error) {
				// Per-channel denial arrives inside a successful SSE response, so it
				// also needs the session check used for ordinary HTTP 401/403 responses.
				if (
					recovery &&
					getBrowserSessionRecovery() === recovery &&
					epoch === recovery.epoch &&
					error instanceof BroadcastClientError
				) {
					if (error.status === 401) recovery.rejectRequest(epoch);
					else if (error.status === 403) void recovery.check();
				}
			},
		});
		return () => {
			try {
				unsubscribe();
			} finally {
				client.close();
			}
		};
	}, [requestsEnabled, currentUserId, queryClient, router, workspaceId]);
	return null;
}

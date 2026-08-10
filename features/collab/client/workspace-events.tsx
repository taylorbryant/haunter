"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useCurrentUser } from "@/components/app-session-provider";
import {
	isWorkspaceCanvasEvent,
	isWorkspaceEvent,
	isWorkspaceTaskEvent,
	workspaceEventAffectedPageIds,
	workspaceEventRemovesPage,
} from "@/features/collab/workspace-events";
import {
	invalidateWorkspaceCanvasProjection,
	invalidateWorkspacePageProjections,
	invalidateWorkspaceTaskProjections,
	reconcileWorkspaceEventConnection,
} from "./workspace-event-cache";

const liveUpdatesEnabled = process.env.NEXT_PUBLIC_LIVE_UPDATES === "true";

export function WorkspaceEventSubscriber({
	workspaceId,
}: {
	workspaceId: string;
}) {
	const queryClient = useQueryClient();
	const currentUser = useCurrentUser();
	const currentUserId = currentUser?.id;
	const router = useRouter();
	const params = useParams<{ pageId?: string | string[] }>();
	const activePageId = Array.isArray(params.pageId)
		? params.pageId[0]
		: params.pageId;
	const activePageIdRef = useRef(activePageId);
	activePageIdRef.current = activePageId;

	useEffect(() => {
		if (!currentUserId || !liveUpdatesEnabled) {
			return;
		}
		let disposed = false;
		let unbind: (() => void) | null = null;
		let flushTimer: ReturnType<typeof setTimeout> | null = null;
		let taskChanged = false;
		const pageIds = new Set<string>();
		const canvasIds = new Set<string>();

		const flush = () => {
			flushTimer = null;
			const pendingPageIds = [...pageIds];
			const pendingCanvasIds = [...canvasIds];
			const pendingTaskChange = taskChanged;
			pageIds.clear();
			canvasIds.clear();
			taskChanged = false;
			if (pendingPageIds.length > 0) {
				void invalidateWorkspacePageProjections(
					queryClient,
					workspaceId,
					pendingPageIds,
				);
			}
			if (pendingTaskChange) {
				void invalidateWorkspaceTaskProjections(queryClient);
			}
			for (const canvasId of pendingCanvasIds) {
				void invalidateWorkspaceCanvasProjection(queryClient, canvasId);
			}
		};
		const scheduleFlush = () => {
			if (flushTimer) return;
			flushTimer = setTimeout(flush, 50);
		};

		void import("./sse").then(({ bindWorkspaceEvents }) => {
			if (disposed) return;
			unbind = bindWorkspaceEvents(workspaceId, {
				onEvent(event) {
					if (!isWorkspaceEvent(event) || event.workspaceId !== workspaceId) {
						return;
					}
					if (isWorkspaceTaskEvent(event)) {
						taskChanged = true;
						scheduleFlush();
						return;
					}
					if (isWorkspaceCanvasEvent(event)) {
						canvasIds.add(event.canvasId);
						scheduleFlush();
						return;
					}
					const currentPageId = activePageIdRef.current;
					if (
						currentPageId &&
						workspaceEventRemovesPage(event, currentPageId)
					) {
						router.replace(`/w/${workspaceId}/home`);
					}
					for (const pageId of workspaceEventAffectedPageIds(event)) {
						pageIds.add(pageId);
					}
					scheduleFlush();
				},
				onConnected() {
					const currentPageId = activePageIdRef.current;
					void reconcileWorkspaceEventConnection(
						queryClient,
						workspaceId,
						currentPageId,
					).then(({ currentPageMissing }) => {
						if (
							currentPageMissing &&
							!disposed &&
							activePageIdRef.current === currentPageId
						) {
							router.replace(`/w/${workspaceId}/home`);
						}
					});
				},
			});
		});
		return () => {
			disposed = true;
			if (flushTimer) clearTimeout(flushTimer);
			unbind?.();
		};
	}, [currentUserId, queryClient, router, workspaceId]);

	return null;
}

"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useCurrentUser } from "@/components/app-session-provider";
import { workspaceRoomId } from "@/features/collab/lib/room";
import {
	isWorkspaceEvent,
	isWorkspaceTaskEvent,
	workspaceEventAffectedPageIds,
	workspaceEventRemovesPage,
} from "@/features/collab/workspace-events";
import {
	invalidateWorkspacePageProjections,
	invalidateWorkspaceTaskProjections,
	pageIsMissingFromWorkspaceProjection,
} from "./workspace-event-cache";

export function WorkspaceEventSubscriber({
	workspaceId,
}: {
	workspaceId: string;
}) {
	const queryClient = useQueryClient();
	const currentUser = useCurrentUser();
	const router = useRouter();
	const params = useParams<{ pageId?: string | string[] }>();
	const activePageId = Array.isArray(params.pageId)
		? params.pageId[0]
		: params.pageId;

	useEffect(() => {
		if (!currentUser) return;
		let disposed = false;
		let unbind: (() => void) | null = null;
		void import("./liveblocks").then(({ bindWorkspaceEvents }) => {
			if (disposed) return;
			unbind = bindWorkspaceEvents(
				workspaceRoomId(workspaceId),
				currentUser.id,
				{
					onEvent(event) {
						if (!isWorkspaceEvent(event) || event.workspaceId !== workspaceId) {
							return;
						}
						if (isWorkspaceTaskEvent(event)) {
							void invalidateWorkspaceTaskProjections(queryClient);
							return;
						}
						if (
							activePageId &&
							workspaceEventRemovesPage(event, activePageId)
						) {
							router.replace(`/w/${workspaceId}/home`);
						}
						void invalidateWorkspacePageProjections(
							queryClient,
							workspaceId,
							workspaceEventAffectedPageIds(event),
						);
					},
					onConnected() {
						// Broadcasts are ephemeral. A fresh connection/reconnection repairs
						// anything missed while this tab was asleep or offline.
						void invalidateWorkspacePageProjections(
							queryClient,
							workspaceId,
						).then(() => {
							if (
								activePageId &&
								pageIsMissingFromWorkspaceProjection(
									queryClient,
									workspaceId,
									activePageId,
								)
							) {
								router.replace(`/w/${workspaceId}/home`);
							}
						});
					},
				},
			);
		});
		return () => {
			disposed = true;
			unbind?.();
		};
	}, [activePageId, currentUser, queryClient, router, workspaceId]);

	return null;
}

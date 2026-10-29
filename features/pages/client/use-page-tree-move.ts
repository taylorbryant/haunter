"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { userErrorMessage } from "@/client/error-feedback";
import {
	canDropPage,
	getPageDropPlacement,
	type PageDropZone,
	type PageTreeIndex,
} from "./page-tree-controller";
import {
	invalidatePages,
	optimisticallySetPagePlacement,
	restorePagePlacementInCache,
	updatePageMutationOptions,
} from "./queries";

export function usePageTreeMove({
	index,
	expanded,
	onExpand,
	onError,
}: {
	index: PageTreeIndex;
	expanded: Readonly<Record<string, boolean>>;
	onExpand: (pageId: string) => void;
	onError: (message: string | null) => void;
}) {
	const queryClient = useQueryClient();
	const mutation = useMutation({
		...updatePageMutationOptions(),
		meta: { errorMode: "silent" },
	});
	const [dragId, setDragId] = useState<string | null>(null);
	const [dropTarget, setDropTarget] = useState<{
		id: string;
		zone: PageDropZone;
	} | null>(null);
	const pendingPageIds = useRef(new Set<string>());

	function canDropOn(targetId: string): boolean {
		return canDropPage(index, dragId, targetId);
	}

	async function commit(
		draggedId: string,
		targetId: string,
		zone: PageDropZone,
	) {
		if (pendingPageIds.current.has(draggedId)) return;
		const dragged = index.nodesById.get(draggedId);
		const target = index.nodesById.get(targetId);
		if (!dragged || !target || !canDropOn(targetId)) return;

		const placement = getPageDropPlacement({
			index,
			draggedId,
			targetId,
			zone,
		});
		if (!placement) return;
		const { parentPageId, position } = placement;
		if (
			parentPageId === dragged.parentPageId &&
			position === dragged.position
		) {
			return;
		}

		if (zone === "inside" && !expanded[target.id]) onExpand(target.id);
		onError(null);
		pendingPageIds.current.add(draggedId);
		let snapshot: Awaited<
			ReturnType<typeof optimisticallySetPagePlacement>
		> | null = null;
		try {
			snapshot = await optimisticallySetPagePlacement(
				queryClient,
				draggedId,
				parentPageId,
				position,
			);
			await mutation.mutateAsync({
				path: { id: draggedId },
				body: { parentPageId, position },
			});
		} catch (error) {
			if (snapshot) {
				restorePagePlacementInCache(queryClient, draggedId, snapshot);
			}
			onError(userErrorMessage(error, "The page could not be moved."));
		} finally {
			pendingPageIds.current.delete(draggedId);
			void invalidatePages(queryClient);
		}
	}

	return {
		dragId,
		dropTarget,
		canDropOn,
		commit,
		startDrag(pageId: string) {
			setDragId(pageId);
		},
		endDrag() {
			setDragId(null);
			setDropTarget(null);
		},
		hover(targetId: string, zone: PageDropZone) {
			setDropTarget((current) =>
				current?.id === targetId && current.zone === zone
					? current
					: { id: targetId, zone },
			);
		},
		leave(targetId: string) {
			setDropTarget((current) => (current?.id === targetId ? null : current));
		},
	};
}

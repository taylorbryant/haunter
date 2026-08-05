"use client";

import type { QueryClient } from "@tanstack/react-query";
import { markLoadStage } from "@/client/load-performance";
import { documentRoomId } from "@/features/collab/lib/room";
import { getPageBootstrapQueryOptions } from "./queries";

/** Start the inexpensive page bootstrap and editor bundle on navigation intent. */
export function preloadPageResources(queryClient: QueryClient, pageId: string) {
	markLoadStage(`page:${pageId}`, "navigation-intent");
	void queryClient.prefetchQuery(getPageBootstrapQueryOptions(pageId));
	// The browser module cache deduplicates repeated pointer intent events.
	void import("@/features/pages/components/editor/haunter-editor");
}

/**
 * Open the authoritative room only for strong intent such as focus or press.
 * A null epoch still starts the remote connection; it only disables IndexedDB
 * hydration until the page list supplies a provider-document incarnation.
 */
export function preloadPageCollaboration(
	pageId: string,
	userId: string,
	documentCacheEpoch: string | null,
) {
	void import("@/features/collab/client/liveblocks").then(({ preloadRoom }) => {
		preloadRoom(documentRoomId("page", pageId), userId, documentCacheEpoch);
	});
}

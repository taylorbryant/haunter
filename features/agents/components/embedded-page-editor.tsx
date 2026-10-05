"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDraftRegistry } from "@/client/use-draft-registry";
import { CommandRegistryProvider } from "@/components/command-palette/registry";
import { CreateDialogProvider } from "@/components/create-dialog-provider";
import { useProtectedRequestsEnabled } from "@/components/session-recovery-provider";
import { SidebarProvider } from "@/components/ui/sidebar";
import { WorkspaceEventSubscriber } from "@/features/collab/client/workspace-events";
import { useCachedPage } from "@/features/pages/client/use-cached-page";
import { PageEditor } from "@/features/pages/components/page-editor";
import { useWorkspaceRouteSync } from "@/features/workspaces/client/use-workspace-route-sync";
import { EmbeddedEditorContext } from "@/features/pages/components/editor/embedded-editor-context";

import { EmbeddedEditorFrame, readBridge, send } from "./embedded-editor-frame";
import {
	listEmbeddedPages,
	createEmbeddedItem,
} from "../client/embedded-workspace";
import type { CompanionPageItem } from "../mcp-app/schemas";
import { observeEmbeddedTextSelection } from "../client/embedded-text-selection";
import type { CanvasSelection } from "../mcp-app/editor-schema";

export function EmbeddedPageEditor({
	workspaceId,
	pageId,
	scoped = false,
}: {
	workspaceId: string;
	scoped?: boolean;
	pageId: string;
}) {
	const { synced } = useWorkspaceRouteSync(workspaceId, { syncActive: true });
	const requestsEnabled = useProtectedRequestsEnabled();
	const page = useCachedPage(pageId);
	const [linkedPages, setLinkedPages] = useState<CompanionPageItem[]>([]);
	useEffect(() => {
		if (!scoped || !requestsEnabled) return;
		let active = true;
		const refresh = () =>
			void listEmbeddedPages()
				.then((pages) => {
					if (active) setLinkedPages(pages);
				})
				.catch(() => {});
		refresh();
		window.addEventListener("focus", refresh);
		return () => {
			active = false;
			window.removeEventListener("focus", refresh);
		};
	}, [scoped, requestsEnabled]);
	const registry = useDraftRegistry();
	const drafts = registry
		.entries()
		.filter(
			(entry) =>
				entry.identity.workspaceId === workspaceId &&
				(entry.identity.resourceId === pageId ||
					entry.identity.resourceType === "canvas"),
		);
	const snapshots = drafts.map((entry) => entry.getSnapshot());
	const saveStatus =
		!page || !drafts.some((entry) => entry.identity.resourceType === "page")
			? "unknown"
			: snapshots.some((draft) => draft.dirty || !draft.locallySaved)
				? "unsaved"
				: snapshots.some((draft) => draft.error || draft.validationError)
					? "unknown"
					: "saved";
	useEffect(() => {
		send(readBridge(), {
			type: "haunter/editor/save-status",
			status: saveStatus,
		});
	}, [saveStatus]);
	useEffect(() => {
		if (page?.title !== undefined)
			send(readBridge(), {
				type: "haunter/editor/metadata",
				title: page.title,
				icon: page.icon,
			});
	}, [page?.title, page?.icon]);
	useEffect(() => {
		if (!requestsEnabled) return;
		return observeEmbeddedTextSelection(pageId, (selection) =>
			send(readBridge(), { type: "haunter/editor/selection", ...selection }),
		);
	}, [pageId, requestsEnabled]);
	const canvasSelectionChanged = useCallback(
		(canvasId: string, selection: CanvasSelection) => {
			if (requestsEnabled)
				send(readBridge(), {
					type: "haunter/editor/inline-canvas-selection",
					canvasId,
					selection,
				});
		},
		[requestsEnabled],
	);
	const embedded = useMemo(
		() =>
			scoped
				? {
						canvasSelectionChanged,
						workspaceId,
						pages: linkedPages,
						openPage: (id: string, targetWorkspaceId = workspaceId) =>
							send(readBridge(), {
								type: "haunter/editor/open-page",
								pageId: id,
								workspaceId: targetWorkspaceId,
							}),
						createItem: createEmbeddedItem,
						openInHaunter: () =>
							send(readBridge(), { type: "haunter/editor/open-web" }),
					}
				: null,
		[scoped, canvasSelectionChanged, workspaceId, linkedPages],
	);
	useEffect(() => {
		const navigateLink = (event: MouseEvent) => {
			if (
				!scoped ||
				event.defaultPrevented ||
				event.button !== 0 ||
				event.metaKey ||
				event.ctrlKey ||
				event.shiftKey ||
				event.altKey
			)
				return;
			const anchor =
				event.target instanceof Element
					? event.target.closest("a[href]")
					: null;
			if (!anchor) return;
			const url = new URL(
				anchor.getAttribute("href") ?? "",
				window.location.href,
			);
			const match = /^\/w\/([^/]+)\/p\/([0-9a-f-]{36})\/?$/i.exec(url.pathname);
			if (url.origin !== window.location.origin || !match) return;
			event.preventDefault();
			event.stopPropagation();
			send(readBridge(), {
				type: "haunter/editor/open-page",
				workspaceId: decodeURIComponent(match[1]),
				pageId: match[2],
			});
		};
		document.addEventListener("click", navigateLink, true);
		const clearCanvas = (event: PointerEvent) => {
			if (
				event.target instanceof Element &&
				!event.target.closest(".haunter-canvas")
			)
				send(readBridge(), {
					type: "haunter/editor/inline-canvas-selection",
					canvasId: null,
					selection: null,
				});
		};
		document.addEventListener("pointerdown", clearCanvas, true);
		return () => {
			document.removeEventListener("pointerdown", clearCanvas, true);
			document.removeEventListener("click", navigateLink, true);
		};
	}, [scoped]);
	if (!synced)
		return (
			<p className="p-6 text-sm text-muted-foreground">
				Opening your workspace…
			</p>
		);
	return (
		<EmbeddedEditorFrame
			status={requestsEnabled ? "ready" : "sign-in-required"}
			pageId={pageId}
		>
			<CommandRegistryProvider>
				<SidebarProvider defaultOpen={false} className="block min-h-0">
					<CreateDialogProvider workspaceId={workspaceId}>
						{scoped ? null : (
							<WorkspaceEventSubscriber workspaceId={workspaceId} />
						)}
						<EmbeddedEditorContext.Provider value={embedded}>
							<PageEditor pageId={pageId} embedded={scoped} />
						</EmbeddedEditorContext.Provider>
					</CreateDialogProvider>
				</SidebarProvider>
			</CommandRegistryProvider>
		</EmbeddedEditorFrame>
	);
}

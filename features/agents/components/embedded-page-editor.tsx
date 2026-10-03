"use client";

import { useEffect, useState } from "react";
import { useDraftRegistry } from "@/client/use-draft-registry";
import { CommandRegistryProvider } from "@/components/command-palette/registry";
import { CreateDialogProvider } from "@/components/create-dialog-provider";
import { GhostLogo } from "@/components/ghost-logo";
import { HeaderSaveIndicator } from "@/components/header-save-indicator";
import { useProtectedRequestsEnabled } from "@/components/session-recovery-provider";
import { Button } from "@/components/ui/button";
import { SidebarProvider } from "@/components/ui/sidebar";
import { WorkspaceEventSubscriber } from "@/features/collab/client/workspace-events";
import { useCachedPage } from "@/features/pages/client/use-cached-page";
import { PageEditor } from "@/features/pages/components/page-editor";
import { useWorkspaceRouteSync } from "@/features/workspaces/client/use-workspace-route-sync";
import { EmbeddedEditorContext } from "@/features/pages/components/editor/embedded-editor-context";
import { MAX_SELECTION_CHARACTERS } from "../mcp-app/editor-schema";

import { EmbeddedEditorFrame, readBridge, send } from "./embedded-editor-frame";

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
	const [selection, setSelection] = useState("");
	const [contextAvailable, setContextAvailable] = useState(false);
	const page = useCachedPage(pageId);
	const registry = useDraftRegistry();
	const drafts = registry
		.entries()
		.filter(
			(entry) =>
				entry.identity.workspaceId === workspaceId &&
				entry.identity.resourceId === pageId &&
				entry.identity.resourceType !== "canvas",
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
		const selectedText = () => {
			const value = window.getSelection();
			const parent = (node: Node | null) =>
				node instanceof Element ? node : node?.parentElement;
			const anchor = parent(value?.anchorNode ?? null)?.closest(
				"[data-haunter-editor-page]",
			);
			const focus = parent(value?.focusNode ?? null)?.closest(
				"[data-haunter-editor-page]",
			);
			setSelection(
				anchor?.getAttribute("data-haunter-editor-page") === pageId &&
					anchor === focus
					? (value?.toString().trim().slice(0, MAX_SELECTION_CHARACTERS) ?? "")
					: "",
			);
		};
		document.addEventListener("selectionchange", selectedText);
		return () => document.removeEventListener("selectionchange", selectedText);
	}, [pageId]);
	if (!synced)
		return (
			<p className="p-6 text-sm text-muted-foreground">
				Opening your workspace…
			</p>
		);
	return (
		<EmbeddedEditorFrame
			status="ready"
			pageId={pageId}
			onContextSupport={setContextAvailable}
		>
			<CommandRegistryProvider>
				<SidebarProvider defaultOpen={false} className="block min-h-0">
					<CreateDialogProvider workspaceId={workspaceId}>
						{scoped ? null : (
							<WorkspaceEventSubscriber workspaceId={workspaceId} />
						)}
						<header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b bg-background/95 px-4 py-2 backdrop-blur-sm">
							<GhostLogo className="size-5" />
							<span className="text-sm font-medium">Haunter</span>
							<HeaderSaveIndicator historyEnabled={!scoped} />
							<Button
								size="sm"
								variant="outline"
								disabled={!selection || !requestsEnabled}
								hidden={!contextAvailable}
								onMouseDown={(event) => event.preventDefault()}
								onClick={() =>
									send(readBridge(), {
										type: "haunter/editor/selection",
										text: selection,
									})
								}
							>
								Use selection as context
							</Button>
						</header>
						<EmbeddedEditorContext.Provider
							value={
								scoped
									? {
											openCanvas: (canvasId) =>
												send(readBridge(), {
													type: "haunter/editor/open-canvas",
													canvasId,
												}),
											openInHaunter: () =>
												send(readBridge(), { type: "haunter/editor/open-web" }),
										}
									: null
							}
						>
							<PageEditor pageId={pageId} embedded={scoped} />
						</EmbeddedEditorContext.Provider>
					</CreateDialogProvider>
				</SidebarProvider>
			</CommandRegistryProvider>
		</EmbeddedEditorFrame>
	);
}

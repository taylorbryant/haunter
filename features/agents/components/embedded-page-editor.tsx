"use client";

import { type ReactNode, useEffect, useState } from "react";
import { draftRegistry } from "@/client/draft-registry";
import { useDraftRegistry } from "@/client/use-draft-registry";
import { useCurrentUser } from "@/components/app-session-provider";
import { CommandRegistryProvider } from "@/components/command-palette/registry";
import { CreateDialogProvider } from "@/components/create-dialog-provider";
import { GhostLogo } from "@/components/ghost-logo";
import { HeaderSaveIndicator } from "@/components/header-save-indicator";
import { useProtectedRequestsEnabled } from "@/components/session-recovery-provider";
import { useEmbeddedHostTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { SidebarProvider } from "@/components/ui/sidebar";
import { WorkspaceEventSubscriber } from "@/features/collab/client/workspace-events";
import { flushPendingPageSave } from "@/features/pages/client/save-state";
import { useCachedPage } from "@/features/pages/client/use-cached-page";
import { PageEditor } from "@/features/pages/components/page-editor";
import { useWorkspaceRouteSync } from "@/features/workspaces/client/use-workspace-route-sync";
import { EmbeddedEditorContext } from "@/features/pages/components/editor/embedded-editor-context";
import { MAX_SELECTION_CHARACTERS } from "../mcp-app/editor-schema";

type EmbeddedBridge = { origin: string; nonce: string };
function readBridge(): EmbeddedBridge | null {
	if (window.parent === window) return null;
	const query = new URLSearchParams(window.location.search);
	const origin = query.get("parentOrigin");
	const nonce = query.get("nonce");
	if (!origin || !nonce || nonce.length > 100) return null;
	try {
		const parsed = new URL(origin);
		if (
			!["https:", "http:"].includes(parsed.protocol) ||
			parsed.origin !== origin
		)
			return null;
		return { origin, nonce };
	} catch {
		return null;
	}
}
function send(bridge: EmbeddedBridge | null, message: Record<string, unknown>) {
	if (bridge)
		window.parent.postMessage(
			{ ...message, nonce: bridge.nonce },
			bridge.origin,
		);
}

/** Only the shell is new. PageEditor retains its ordinary APIs and document session. */
export function EmbeddedEditorFrame({
	status,
	pageId,
	onContextSupport,
	children,
}: {
	status: "ready" | "sign-in-required" | "access-denied";
	pageId: string;
	children: ReactNode;
	onContextSupport?: (available: boolean) => void;
}) {
	const user = useCurrentUser();
	const userId = user?.id;
	const setHostTheme = useEmbeddedHostTheme();
	useEffect(() => {
		const bridge = readBridge();
		send(bridge, { type: "haunter/editor/status", status });
		let active = true;
		const message = async (event: MessageEvent) => {
			if (
				!bridge ||
				event.source !== window.parent ||
				event.origin !== bridge.origin ||
				event.data?.nonce !== bridge.nonce
			)
				return;
			if (
				event.data?.type === "haunter/editor/theme" &&
				["light", "dark"].includes(event.data.theme)
			)
				setHostTheme?.(event.data.theme);
			if (event.data?.type === "haunter/editor/context-support")
				onContextSupport?.(event.data.available === true);
			if (event.data?.type === "haunter/editor/resume") {
				document.body.inert = false;
				return;
			}
			if (
				event.data?.type !== "haunter/editor/flush" ||
				typeof event.data.requestId !== "string"
			)
				return;
			const requestId = event.data.requestId;
			if (event.data.pause) {
				// Blur commits active title/input edits before freezing keyboard and pointer
				// input. Keep it frozen until the parent replaces the frame or resumes it.
				if (document.activeElement instanceof HTMLElement)
					document.activeElement.blur();
				document.body.inert = true;
			}
			let locallySaved = true;
			let saved = true;
			if (userId) {
				locallySaved = await draftRegistry
					.flushLocal(userId)
					.catch(() => false);
				let timer: ReturnType<typeof setTimeout> | undefined;
				saved = await Promise.race([
					flushPendingPageSave(pageId).catch(() => false),
					new Promise<boolean>((resolve) => {
						timer = setTimeout(() => resolve(false), 5000);
					}),
				]);
				clearTimeout(timer);
			}
			if (active)
				send(bridge, {
					type: "haunter/editor/flushed",
					requestId,
					locallySaved,
					saved,
				});
		};
		const listener = (event: MessageEvent) => {
			void message(event).catch(() => {
				send(bridge, {
					type: "haunter/editor/flushed",
					requestId: event.data?.requestId,
					locallySaved: false,
					saved: false,
				});
			});
		};
		window.addEventListener("message", listener);
		return () => {
			active = false;
			window.removeEventListener("message", listener);
		};
	}, [status, pageId, userId, setHostTheme, onContextSupport]);
	return (
		<main
			className="isolate min-h-svh overflow-x-clip bg-background text-foreground"
			data-haunter-embedded-editor
		>
			{children}
		</main>
	);
}

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

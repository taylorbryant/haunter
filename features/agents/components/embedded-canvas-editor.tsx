"use client";

import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { type Editor, react } from "tldraw";
import { useDraftRegistry } from "@/client/use-draft-registry";
import { useProtectedRequestsEnabled } from "@/components/session-recovery-provider";
import { GhostLogo } from "@/components/ghost-logo";
import { Button } from "@/components/ui/button";
import { getCanvasQueryOptions } from "@/features/canvases/client/queries";
import { useWorkspaceRouteSync } from "@/features/workspaces/client/use-workspace-route-sync";
import { EmbeddedEditorFrame, readBridge, send } from "./embedded-editor-frame";

const CanvasSurface = dynamic(
	() => import("@/features/canvases/components/canvas-surface"),
	{ ssr: false },
);

export function EmbeddedCanvasEditor({
	workspaceId,
	canvasId,
}: {
	workspaceId: string;
	canvasId: string;
}) {
	const { synced } = useWorkspaceRouteSync(workspaceId, { syncActive: true });
	const requestsEnabled = useProtectedRequestsEnabled();
	const canvas = useQuery(getCanvasQueryOptions(canvasId));
	const [editor, setEditor] = useState<Editor | null>(null);
	const registry = useDraftRegistry();
	const drafts = registry
		.entries()
		.filter(
			(entry) =>
				entry.identity.workspaceId === workspaceId &&
				entry.identity.resourceId === canvasId &&
				entry.identity.resourceType === "canvas",
		);
	const states = drafts.map((entry) => entry.getSnapshot());
	const saveStatus =
		!editor || !states.length
			? "unknown"
			: states.some((state) => state.dirty || !state.locallySaved)
				? "unsaved"
				: states.some((state) => state.error || state.validationError)
					? "unknown"
					: "saved";
	useEffect(() => {
		send(readBridge(), {
			type: "haunter/editor/save-status",
			status: saveStatus,
		});
	}, [saveStatus]);
	useEffect(() => {
		if (canvas.data)
			send(readBridge(), {
				type: "haunter/editor/metadata",
				title: canvas.data.title || "Canvas",
				icon: null,
			});
	}, [canvas.data]);
	useEffect(() => {
		if (!editor) return;
		let previous = "";
		return react("Embedded canvas selection", () => {
			const ids = editor.getSelectedShapeIds();
			const selection = {
				canvasPageId: editor.getCurrentPageId(),
				selectedShapeIds: [...ids].slice(0, 100),
				selectionCount: ids.length,
				selectionComplete: ids.length <= 100,
			};
			const signature = JSON.stringify(selection);
			if (signature === previous) return;
			previous = signature;
			send(readBridge(), {
				type: "haunter/editor/canvas-selection",
				selection,
			});
		});
	}, [editor]);
	return (
		<EmbeddedEditorFrame
			canvasId={canvasId}
			status={
				!requestsEnabled
					? "sign-in-required"
					: canvas.isError
						? "access-denied"
						: editor
							? "ready"
							: "opening"
			}
		>
			<div className="flex h-svh min-h-0 flex-col">
				<header className="flex shrink-0 items-center gap-3 border-b bg-background px-4 py-2">
					<GhostLogo className="size-5" />
					<span className="min-w-0 flex-1 truncate text-sm font-medium">
						{canvas.data?.title || "Canvas"}
					</span>
					<span className="text-xs text-muted-foreground" role="status">
						{saveStatus === "saved"
							? "Saved"
							: saveStatus === "unsaved"
								? "Saving…"
								: "Connecting…"}
					</span>
					{canvas.data?.pageId && (
						<Button
							size="sm"
							variant="ghost"
							onClick={() =>
								send(readBridge(), {
									type: "haunter/editor/open-page",
									pageId: canvas.data?.pageId,
								})
							}
						>
							Back to page
						</Button>
					)}
				</header>
				<div className="min-h-0 flex-1">
					{synced ? (
						<CanvasSurface
							canvasId={canvasId}
							embedded
							layoutKey="embedded"
							onEditorChange={setEditor}
						/>
					) : (
						<p className="p-6 text-sm">Opening your workspace…</p>
					)}
				</div>
			</div>
		</EmbeddedEditorFrame>
	);
}

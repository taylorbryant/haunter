"use client";

import { createContext, useContext } from "react";
import type { CompanionPageItem } from "@/features/agents/mcp-app/schemas";
import type { CanvasSelection } from "@/features/agents/mcp-app/editor-schema";
import type { SelectedTask } from "@/features/tasks/current-view";

/** A scoped page editor includes its inline canvases, with other features opened separately. */
export const EmbeddedEditorContext = createContext<{
	openInHaunter(): void;
	workspaceId: string;
	pageId?: string;
	taskControls?: boolean;
	fileUploads?: boolean;
	taskSelectionChanged?(
		blockId: string,
		task: SelectedTask | undefined,
		activate?: boolean,
	): void;
	pages: CompanionPageItem[];
	openPage(pageId: string, workspaceId?: string): void;
	createItem(action: "create-page" | "create-canvas"): Promise<{ id: string }>;
	canvasSelectionChanged?(canvasId: string, selection: CanvasSelection): void;
} | null>(null);
export const useEmbeddedEditor = () => useContext(EmbeddedEditorContext);

export function EmbeddedFeatureLink({
	pageId,
	workspaceId,
}: {
	pageId: string;
	workspaceId: string;
}) {
	const embedded = useEmbeddedEditor();
	const page = embedded?.pages.find((p) => p.pageId === pageId);
	return (
		<button
			type="button"
			contentEditable={false}
			className="rounded px-1 py-0.5 font-medium underline decoration-muted-foreground/50 underline-offset-4 hover:bg-muted"
			onClick={() => embedded?.openPage(pageId, workspaceId)}
		>
			{page?.icon ? `${page.icon} ` : ""}
			{page?.title || "Open linked page"}
		</button>
	);
}

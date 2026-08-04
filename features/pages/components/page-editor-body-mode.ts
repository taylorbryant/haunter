import type { CollabSession } from "@/features/collab/client/session";

export type PageEditorBodyMode = "loading" | "collaboration" | "fallback";

/**
 * Never mount the database projection as a temporary BlockNote document. A
 * stable skeleton remains until the real Yjs document and editor bundle are
 * ready; the projection is reserved for an explicit collaboration outage.
 */
export function pageEditorBodyMode(
	status: CollabSession["status"],
	editorLoaded: boolean,
	editorFailed = false,
): PageEditorBodyMode {
	if (status === "unavailable" || editorFailed) return "fallback";
	return status === "ready" && editorLoaded ? "collaboration" : "loading";
}

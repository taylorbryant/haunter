import type { CollabSession } from "@/features/collab/client/session";

export type PageEditorBodyMode = "projection" | "collaboration";

/**
 * Keep the fetched projection mounted until both the authoritative room and
 * the collaborative editor bundle are ready. This makes the transition to
 * live editing a single render instead of flashing a second loading skeleton.
 */
export function pageEditorBodyMode(
	status: CollabSession["status"],
	editorLoaded: boolean,
): PageEditorBodyMode {
	return status === "ready" && editorLoaded ? "collaboration" : "projection";
}

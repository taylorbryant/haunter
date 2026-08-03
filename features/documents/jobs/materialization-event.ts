import type { WorkspacePageEvent } from "@/features/collab/workspace-events";
import type { MaterializeResult } from "@/features/documents/service";

type PageMaterializeResult = Extract<MaterializeResult, { kind: "page" }>;

/** Choose one invalidation hint for the SQLite projections changed by a Ydoc.
 * A title event already invalidates every page projection, so a combined
 * title/content materialization does not need a second broadcast. */
export function pageMaterializationEventType(
	result: PageMaterializeResult,
): WorkspacePageEvent["type"] | null {
	if (result.status === "unchanged") return null;
	if (result.titleChanged) return "page.renamed";
	if (result.contentChanged || result.tasksChanged || result.linksChanged) {
		return "page.contentChanged";
	}
	return null;
}

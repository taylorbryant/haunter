import type * as Y from "yjs";
import { COLLAB_SEEDED_KEY } from "@/features/pages/lib/collab-document";
import { CANVAS_META_NAME, type DocumentKind, PAGE_META_NAME } from "./model";

export const CANVAS_SEEDED_KEY = "canvasSeeded";

/** A browser cache is safe to render only after the server has seeded the
 * authoritative document. Empty IndexedDB databases also report themselves
 * as loaded, so document shape alone is not a sufficient readiness signal. */
export function isCollaborativeDocumentSeeded(
	doc: Y.Doc,
	kind: DocumentKind,
): boolean {
	return kind === "page"
		? doc.getMap(PAGE_META_NAME).get(COLLAB_SEEDED_KEY) === true
		: doc.getMap(CANVAS_META_NAME).get(CANVAS_SEEDED_KEY) === true;
}

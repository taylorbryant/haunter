import { appError } from "@/features/shared/errors";

/** Body-only token, bound to this page and document generation. Treat as opaque. */
export function documentRevision(document: {
	pageId: string;
	generation: number;
	revision: number;
}) {
	return `v1:${document.pageId}:${document.generation}:${document.revision}`;
}

export function assertDocumentRevision(
	document: Parameters<typeof documentRevision>[0],
	expected?: string,
) {
	if (expected !== undefined && expected !== documentRevision(document)) {
		throw appError("PageRevisionConflict", {
			details: { currentRevision: documentRevision(document) },
		});
	}
}

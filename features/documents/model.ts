export const DOCUMENT_SCHEMA_VERSION = 1;
export const PAGE_BODY_FRAGMENT = "body";
export const DOCUMENT_META = "haunter";
export type DocumentResetReason = "replacement" | "restore";

export function pageDocumentName(
	workspaceId: string,
	pageId: string,
	generation = 0,
) {
	return `page:${workspaceId}:${pageId}:v${DOCUMENT_SCHEMA_VERSION}${generation ? `:g${generation}` : ""}`;
}

import type { Page, PageMeta } from "@/features/pages/schemas";

export type NewPage = {
	userId: string;
	workspaceId: string;
	parentPageId: string | null;
	title: string;
	position: number;
};

export type UpdatePageData = {
	title?: string;
	icon?: string | null;
	parentPageId?: string | null;
	position?: number;
};

export interface PageLinkRepository {
	/** Replace the outgoing links of a source page with the given targets. */
	replaceForSource(
		sourcePageId: string,
		userId: string,
		targetPageIds: string[],
	): Promise<void>;
	/** Live pages that link to the target, most recently updated first. */
	listBacklinkSources(targetPageId: string): Promise<PageMeta[]>;
}

export interface PageRepository {
	/** Live (non-trashed) pages only. */
	listMetaByWorkspace(workspaceId: string): Promise<PageMeta[]>;
	/** All trashed pages in the workspace, subtree members included. */
	listTrashedMetaByWorkspace(workspaceId: string): Promise<PageMeta[]>;
	findById(id: string): Promise<Page | null>;
	findMetaById(id: string): Promise<PageMeta | null>;
	listIdsByParent(parentPageId: string): Promise<string[]>;
	/**
	 * Live pages owned by the user whose title or raw content JSON contains
	 * the needle (case-insensitive), newest first. Candidates only — content
	 * matches are re-verified against extracted block text by the caller.
	 */
	searchByUser(userId: string, needle: string, limit: number): Promise<Page[]>;
	create(input: NewPage): Promise<PageMeta>;
	update(id: string, input: UpdatePageData): Promise<PageMeta>;
	saveContent(id: string, contentJson: string): Promise<{ updatedAt: string }>;
	/** Set or clear deletedAt for the given pages. */
	setDeletedByIds(ids: string[], deletedAt: string | null): Promise<void>;
	deleteByIds(ids: string[]): Promise<void>;
	deleteByWorkspace(workspaceId: string): Promise<void>;
}

import type {
	Page,
	PageMeta,
	PageVersion,
	PageVersionMeta,
} from "@/features/pages/schemas";

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

export type PageHierarchyRow = {
	id: string;
	parentPageId: string | null;
};

export type PageSearchCandidate = PageMeta & {
	searchText: string;
};

export interface PageLinkRepository {
	/** Replace the outgoing links of a source page with the given targets. */
	replaceForSource(
		sourcePageId: string,
		userId: string,
		targetPageIds: string[],
	): Promise<boolean>;
	/** Live pages that link to the target, most recently updated first. */
	listBacklinkSources(targetPageId: string): Promise<PageMeta[]>;
}

export interface PageRepository {
	/** Live (non-trashed) pages only. */
	listMetaByWorkspace(workspaceId: string): Promise<PageMeta[]>;
	/** Minimal parent links for every page in a workspace, including trash. */
	listHierarchyByWorkspace(workspaceId: string): Promise<PageHierarchyRow[]>;
	/** All trashed pages in the workspace, subtree members included. */
	listTrashedMetaByWorkspace(workspaceId: string): Promise<PageMeta[]>;
	findById(id: string): Promise<Page | null>;
	findMetaById(id: string): Promise<PageMeta | null>;
	findMetaByIds(ids: string[]): Promise<PageMeta[]>;
	listIdsByParent(parentPageId: string): Promise<string[]>;
	maxPositionForParent(
		workspaceId: string,
		parentPageId: string | null,
	): Promise<number>;
	/**
	 * Live pages in the workspace whose title or materialized plain text contains
	 * the needle (case-insensitive), newest first.
	 */
	searchByWorkspace(
		workspaceId: string,
		needle: string,
		limit: number,
	): Promise<PageSearchCandidate[]>;
	create(input: NewPage): Promise<PageMeta>;
	update(id: string, input: UpdatePageData): Promise<PageMeta>;
	saveContent(
		id: string,
		contentJson: string,
		searchText: string,
	): Promise<{ updatedAt: string }>;
	/**
	 * Compare-and-set variant: persist only if the row's updatedAt still
	 * equals `baseUpdatedAt`. Returns null when the row moved on (stale write).
	 */
	saveContentIf(
		id: string,
		contentJson: string,
		searchText: string,
		baseUpdatedAt: string,
	): Promise<{ updatedAt: string } | null>;
	/** Set or clear deletedAt for the given pages. */
	setDeletedByIds(ids: string[], deletedAt: string | null): Promise<void>;
	deleteByIds(ids: string[]): Promise<void>;
	deleteByWorkspace(workspaceId: string): Promise<void>;
}

export type NewPageVersion = {
	pageId: string;
	workspaceId: string;
	title: string;
	icon: string | null;
	contentJson: string;
	cause: "checkpoint" | "restore";
	createdBy: string;
};

export interface PageVersionRepository {
	/** Newest first, metadata only (no content payloads). */
	listMetaByPage(pageId: string): Promise<PageVersionMeta[]>;
	findById(id: string): Promise<PageVersion | null>;
	/** The newest version's createdAt, for checkpoint spacing. */
	latestCreatedAt(pageId: string): Promise<string | null>;
	create(input: NewPageVersion): Promise<PageVersionMeta>;
	/** Delete all but the newest `keep` versions of a page. */
	prune(pageId: string, keep: number): Promise<void>;
}

import type { TenantScope } from "@beignet/core/ports";
import type {
	Page,
	PageMeta,
	PageNavigationItem,
	PageVersion,
	PageVersionMeta,
} from "@/features/pages/schemas";

export type NewPage = {
	userId: string;
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
		scope: TenantScope,
		sourcePageId: string,
		userId: string,
		targetPageIds: string[],
	): Promise<boolean>;
	/** Live pages that link to the target, most recently updated first. */
	listBacklinkSources(
		scope: TenantScope,
		targetPageId: string,
	): Promise<PageMeta[]>;
}

export interface PageRepository {
	/** Live (non-trashed) pages only. */
	listMetaByWorkspace(scope: TenantScope): Promise<PageMeta[]>;
	/** Minimal parent links for every page in a workspace, including trash. */
	listHierarchyByWorkspace(scope: TenantScope): Promise<PageHierarchyRow[]>;
	/** All trashed pages in the workspace, subtree members included. */
	listTrashedMetaByWorkspace(scope: TenantScope): Promise<PageMeta[]>;
	findById(scope: TenantScope, id: string): Promise<Page | null>;
	findMetaById(scope: TenantScope, id: string): Promise<PageMeta | null>;
	findMetaByIds(scope: TenantScope, ids: string[]): Promise<PageMeta[]>;
	listIdsByParent(scope: TenantScope, parentPageId: string): Promise<string[]>;
	maxPositionForParent(
		scope: TenantScope,
		parentPageId: string | null,
	): Promise<number>;
	/**
	 * Live pages in the workspace whose title or materialized plain text contains
	 * the needle (case-insensitive), newest first.
	 */
	searchByWorkspace(
		scope: TenantScope,
		needle: string,
		limit: number,
	): Promise<PageSearchCandidate[]>;
	create(
		scope: TenantScope,
		input: NewPage,
	): Promise<PageMeta & { contentUpdatedAt: string }>;
	update(
		scope: TenantScope,
		id: string,
		input: UpdatePageData,
	): Promise<PageMeta>;
	/** Apply metadata only while the persisted title still equals the caller's base. */
	updateIfTitle(
		scope: TenantScope,
		id: string,
		input: UpdatePageData,
		baseTitle: string,
	): Promise<PageMeta | null>;
	saveContent(
		scope: TenantScope,
		id: string,
		contentJson: string,
		searchText: string,
	): Promise<{ updatedAt: string; contentUpdatedAt: string }>;
	/**
	 * Compare-and-set variant: persist only if the row's contentUpdatedAt still
	 * equals `baseUpdatedAt`. Returns null when the row moved on (stale write).
	 */
	saveContentIf(
		scope: TenantScope,
		id: string,
		contentJson: string,
		searchText: string,
		baseUpdatedAt: string,
	): Promise<{ updatedAt: string; contentUpdatedAt: string } | null>;
	/** Set or clear deletedAt for the given pages. */
	setDeletedByIds(
		scope: TenantScope,
		ids: string[],
		deletedAt: string | null,
	): Promise<void>;
	deleteByIds(scope: TenantScope, ids: string[]): Promise<void>;
	deleteByWorkspace(scope: TenantScope): Promise<void>;
}

export interface PageNavigationRepository {
	listForUser(
		scope: TenantScope,
		userId: string,
		recentLimit: number,
	): Promise<{
		favorites: PageNavigationItem[];
		recents: PageNavigationItem[];
	}>;
	setFavorite(
		scope: TenantScope,
		userId: string,
		pageId: string,
		favorite: boolean,
	): Promise<string | null>;
	recordView(
		scope: TenantScope,
		userId: string,
		pageId: string,
	): Promise<string>;
}

export type NewPageVersion = {
	pageId: string;
	title: string;
	icon: string | null;
	contentJson: string;
	cause: "checkpoint" | "restore";
	createdBy: string;
};

export interface PageVersionRepository {
	/** Newest first, metadata only (no content payloads). */
	listMetaByPage(
		scope: TenantScope,
		pageId: string,
	): Promise<PageVersionMeta[]>;
	findById(scope: TenantScope, id: string): Promise<PageVersion | null>;
	/** The newest version's createdAt, for checkpoint spacing. */
	latestCreatedAt(scope: TenantScope, pageId: string): Promise<string | null>;
	create(scope: TenantScope, input: NewPageVersion): Promise<PageVersionMeta>;
	/** Delete all but the newest `keep` versions of a page. */
	prune(scope: TenantScope, pageId: string, keep: number): Promise<void>;
}

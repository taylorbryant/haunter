import { tenantScopeId } from "@beignet/core/ports";
import type {
	WorkspaceEvent,
	WorkspaceEventPublisherPort,
} from "@/features/collab/workspace-events";
import { extractPageSearchText } from "@/features/pages/lib/extract-page-text";
import type {
	NewPage,
	NewPageVersion,
	PageLinkRepository,
	PageNavigationRepository,
	PageRepository,
	PageVersionRepository,
	UpdatePageData,
} from "@/features/pages/ports";
import type { Page, PageMeta, PageVersion } from "@/features/pages/schemas";

export function createTestWorkspaceEventPublisher(
	published: WorkspaceEvent[] = [],
): WorkspaceEventPublisherPort {
	return {
		async publish(event) {
			published.push(event);
		},
	};
}

export function createTestPageLinkRepository(deps: {
	pages: PageRepository;
}): PageLinkRepository {
	const linksBySource = new Map<string, string[]>();

	return {
		async replaceForSource(
			scope,
			sourcePageId: string,
			_userId: string,
			targetPageIds: string[],
		) {
			if (!(await deps.pages.findMetaById(scope, sourcePageId))) {
				throw new Error(`Page ${sourcePageId} is outside the tenant scope`);
			}
			const targets = await deps.pages.findMetaByIds(scope, targetPageIds);
			if (targets.length !== new Set(targetPageIds).size) {
				throw new Error("Page links cannot cross tenant boundaries");
			}
			const current = linksBySource.get(sourcePageId) ?? [];
			const currentIds = [...current].sort();
			const nextIds = [...targetPageIds].sort();
			if (
				currentIds.length === nextIds.length &&
				currentIds.every((id, index) => id === nextIds[index])
			) {
				return false;
			}
			linksBySource.set(sourcePageId, [...targetPageIds]);
			return true;
		},
		async listBacklinkSources(scope, targetPageId: string) {
			const sources: PageMeta[] = [];
			for (const [sourcePageId, targets] of linksBySource) {
				if (!targets.includes(targetPageId)) continue;
				const source = await deps.pages.findMetaById(scope, sourcePageId);
				if (source && source.deletedAt === null) {
					sources.push(source);
				}
			}
			return sources.sort((left, right) =>
				right.updatedAt.localeCompare(left.updatedAt),
			);
		},
	};
}

export function createTestPageNavigationRepository(deps: {
	pages: PageRepository;
}): PageNavigationRepository {
	const states = new Map<
		string,
		{
			workspaceId: string;
			favoritedAt: string | null;
			lastViewedAt: string | null;
		}
	>();
	let sequence = 0;
	const timestamp = () => {
		sequence += 1;
		return new Date(Date.now() + sequence).toISOString();
	};
	const key = (userId: string, pageId: string) => `${userId}:${pageId}`;

	return {
		async listForUser(scope, userId, recentLimit) {
			const pages = await deps.pages.listMetaByWorkspace(scope);
			const items = pages.flatMap((page) => {
				const state = states.get(key(userId, page.id));
				return state ? [{ ...page, ...state }] : [];
			});
			return {
				favorites: items
					.filter((item) => item.favoritedAt !== null)
					.sort((left, right) =>
						(right.favoritedAt ?? "").localeCompare(left.favoritedAt ?? ""),
					),
				recents: items
					.filter((item) => item.lastViewedAt !== null)
					.sort((left, right) =>
						(right.lastViewedAt ?? "").localeCompare(left.lastViewedAt ?? ""),
					)
					.slice(0, recentLimit),
			};
		},
		async setFavorite(scope, userId, pageId, favorite) {
			const page = await deps.pages.findMetaById(scope, pageId);
			if (!page) throw new Error(`Page not found: ${pageId}`);
			const stateKey = key(userId, pageId);
			const current = states.get(stateKey);
			const favoritedAt = favorite ? timestamp() : null;
			if (!favorite && !current?.lastViewedAt) states.delete(stateKey);
			else {
				states.set(stateKey, {
					workspaceId: page.workspaceId,
					favoritedAt,
					lastViewedAt: current?.lastViewedAt ?? null,
				});
			}
			return favoritedAt;
		},
		async recordView(scope, userId, pageId) {
			const page = await deps.pages.findMetaById(scope, pageId);
			if (!page) throw new Error(`Page not found: ${pageId}`);
			const stateKey = key(userId, pageId);
			const current = states.get(stateKey);
			const lastViewedAt = timestamp();
			states.set(stateKey, {
				workspaceId: page.workspaceId,
				favoritedAt: current?.favoritedAt ?? null,
				lastViewedAt,
			});
			return lastViewedAt;
		},
	};
}

export function createTestPageRepository(): PageRepository {
	const pages = new Map<string, Page>();

	function toMeta(page: Page): PageMeta {
		const {
			content: _content,
			contentUpdatedAt: _contentUpdatedAt,
			...meta
		} = page;
		return meta;
	}

	return {
		async listMetaByWorkspace(scope) {
			const workspaceId = tenantScopeId(scope);
			return Array.from(pages.values())
				.filter(
					(page) => page.workspaceId === workspaceId && page.deletedAt === null,
				)
				.sort((left, right) => left.position - right.position)
				.map(toMeta);
		},
		async listHierarchyByWorkspace(scope) {
			const workspaceId = tenantScopeId(scope);
			return Array.from(pages.values())
				.filter((page) => page.workspaceId === workspaceId)
				.map((page) => ({
					id: page.id,
					parentPageId: page.parentPageId,
				}));
		},
		async listTrashedMetaByWorkspace(scope) {
			const workspaceId = tenantScopeId(scope);
			return Array.from(pages.values())
				.filter(
					(page) => page.workspaceId === workspaceId && page.deletedAt !== null,
				)
				.sort((left, right) => left.position - right.position)
				.map(toMeta);
		},
		async findById(scope, id: string) {
			const page = pages.get(id);
			return page?.workspaceId === tenantScopeId(scope) ? page : null;
		},
		async findMetaById(scope, id: string) {
			const page = pages.get(id);
			return page?.workspaceId === tenantScopeId(scope) ? toMeta(page) : null;
		},
		async findMetaByIds(scope, ids: string[]) {
			const wanted = new Set(ids);
			return Array.from(pages.values())
				.filter(
					(page) =>
						page.workspaceId === tenantScopeId(scope) && wanted.has(page.id),
				)
				.map(toMeta);
		},
		async searchByWorkspace(scope, needle: string, limit: number) {
			const workspaceId = tenantScopeId(scope);
			const lowered = needle.toLowerCase();
			return Array.from(pages.values())
				.filter(
					(page) =>
						page.workspaceId === workspaceId &&
						page.deletedAt === null &&
						(page.title.toLowerCase().includes(lowered) ||
							extractPageSearchText(page.content)
								.toLowerCase()
								.includes(lowered)),
				)
				.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
				.slice(0, limit)
				.map((page) => ({
					...toMeta(page),
					searchText: extractPageSearchText(page.content),
				}));
		},
		async listIdsByParent(scope, parentPageId: string) {
			return Array.from(pages.values())
				.filter(
					(page) =>
						page.workspaceId === tenantScopeId(scope) &&
						page.parentPageId === parentPageId,
				)
				.map((page) => page.id);
		},
		async maxPositionForParent(scope, parentPageId: string | null) {
			const workspaceId = tenantScopeId(scope);
			return Array.from(pages.values())
				.filter(
					(page) =>
						page.workspaceId === workspaceId &&
						page.deletedAt === null &&
						page.parentPageId === parentPageId,
				)
				.reduce((max, page) => Math.max(max, page.position), 0);
		},
		async create(scope, input: NewPage) {
			const now = new Date().toISOString();
			const page: Page = {
				id: crypto.randomUUID(),
				userId: input.userId,
				workspaceId: tenantScopeId(scope),
				parentPageId: input.parentPageId,
				title: input.title,
				icon: null,
				position: input.position,
				content: [],
				contentUpdatedAt: now,
				deletedAt: null,
				createdAt: now,
				updatedAt: now,
			};
			pages.set(page.id, page);
			return { ...toMeta(page), contentUpdatedAt: page.contentUpdatedAt };
		},
		async update(scope, id: string, input: UpdatePageData) {
			const page = pages.get(id);
			if (!page || page.workspaceId !== tenantScopeId(scope)) {
				throw new Error(`Page not found: ${id}`);
			}

			const next = { ...page, ...input, updatedAt: new Date().toISOString() };
			pages.set(id, next);
			return toMeta(next);
		},
		async saveContent(
			scope,
			id: string,
			contentJson: string,
			_searchText: string,
		) {
			const page = pages.get(id);
			if (!page || page.workspaceId !== tenantScopeId(scope)) {
				throw new Error(`Page not found: ${id}`);
			}

			const contentUpdatedAt = new Date(
				Math.max(
					Date.now(),
					Date.parse(page.updatedAt) + 1,
					Date.parse(page.contentUpdatedAt) + 1,
				),
			).toISOString();
			const updatedAt =
				page.updatedAt >= contentUpdatedAt ? page.updatedAt : contentUpdatedAt;
			pages.set(id, {
				...page,
				content: JSON.parse(contentJson),
				contentUpdatedAt,
				updatedAt,
			});
			return { updatedAt, contentUpdatedAt };
		},
		async saveContentIf(
			scope,
			id: string,
			contentJson: string,
			_searchText: string,
			baseUpdatedAt: string,
		) {
			const page = pages.get(id);
			if (!page || page.workspaceId !== tenantScopeId(scope)) {
				throw new Error(`Page not found: ${id}`);
			}
			if (page.contentUpdatedAt !== baseUpdatedAt) {
				return null;
			}

			// Strictly after the base version, mirroring the drizzle repo.
			const contentUpdatedAt = new Date(
				Math.max(
					Date.now(),
					Date.parse(page.updatedAt) + 1,
					Date.parse(baseUpdatedAt) + 1,
				),
			).toISOString();
			const updatedAt =
				page.updatedAt >= contentUpdatedAt ? page.updatedAt : contentUpdatedAt;
			pages.set(id, {
				...page,
				content: JSON.parse(contentJson),
				contentUpdatedAt,
				updatedAt,
			});
			return { updatedAt, contentUpdatedAt };
		},
		async setDeletedByIds(scope, ids: string[], deletedAt: string | null) {
			for (const id of ids) {
				const page = pages.get(id);
				if (page?.workspaceId === tenantScopeId(scope)) {
					pages.set(id, {
						...page,
						deletedAt,
						updatedAt: new Date().toISOString(),
					});
				}
			}
		},
		async deleteByIds(scope, ids: string[]) {
			for (const id of ids) {
				if (pages.get(id)?.workspaceId === tenantScopeId(scope)) {
					pages.delete(id);
				}
			}
		},
		async deleteByWorkspace(scope) {
			const workspaceId = tenantScopeId(scope);
			for (const page of Array.from(pages.values())) {
				if (page.workspaceId === workspaceId) {
					pages.delete(page.id);
				}
			}
		},
	};
}

export function createTestPageVersionRepository(): PageVersionRepository {
	type StoredVersion = PageVersion & { workspaceId: string };
	const versions = new Map<string, StoredVersion>();

	function versionsByPage(scopeId: string, pageId: string): StoredVersion[] {
		return Array.from(versions.values())
			.filter(
				(version) =>
					version.workspaceId === scopeId && version.pageId === pageId,
			)
			.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
	}

	return {
		async listMetaByPage(scope, pageId: string) {
			return versionsByPage(tenantScopeId(scope), pageId).map(
				({ content: _content, workspaceId: _workspaceId, ...meta }) => ({
					...meta,
				}),
			);
		},
		async findById(scope, id: string) {
			const version = versions.get(id);
			if (!version || version.workspaceId !== tenantScopeId(scope)) return null;
			const { workspaceId: _workspaceId, ...result } = version;
			return result;
		},
		async latestCreatedAt(scope, pageId: string) {
			return versionsByPage(tenantScopeId(scope), pageId)[0]?.createdAt ?? null;
		},
		async create(scope, input: NewPageVersion) {
			const version: StoredVersion = {
				id: crypto.randomUUID(),
				workspaceId: tenantScopeId(scope),
				pageId: input.pageId,
				title: input.title,
				icon: input.icon,
				cause: input.cause,
				createdBy: input.createdBy,
				createdByName: null,
				createdAt: new Date().toISOString(),
				content: JSON.parse(input.contentJson),
			};
			versions.set(version.id, version);
			const { content: _content, workspaceId: _workspaceId, ...meta } = version;
			return meta;
		},
		async prune(scope, pageId: string, keep: number) {
			for (const stale of versionsByPage(tenantScopeId(scope), pageId).slice(
				keep,
			)) {
				versions.delete(stale.id);
			}
		},
	};
}

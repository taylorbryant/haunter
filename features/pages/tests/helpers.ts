import type {
	NewPage,
	NewPageVersion,
	PageLinkRepository,
	PageRepository,
	PageVersionRepository,
	UpdatePageData,
} from "@/features/pages/ports";
import type { Page, PageMeta, PageVersion } from "@/features/pages/schemas";

export function createTestPageLinkRepository(deps: {
	pages: PageRepository;
}): PageLinkRepository {
	const linksBySource = new Map<string, string[]>();

	return {
		async replaceForSource(
			sourcePageId: string,
			_userId: string,
			targetPageIds: string[],
		) {
			linksBySource.set(sourcePageId, [...targetPageIds]);
		},
		async listBacklinkSources(targetPageId: string) {
			const sources: PageMeta[] = [];
			for (const [sourcePageId, targets] of linksBySource) {
				if (!targets.includes(targetPageId)) continue;
				const source = await deps.pages.findMetaById(sourcePageId);
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

export function createTestPageRepository(): PageRepository {
	const pages = new Map<string, Page>();

	function toMeta(page: Page): PageMeta {
		const { content: _content, ...meta } = page;
		return meta;
	}

	return {
		async listMetaByWorkspace(workspaceId: string) {
			return Array.from(pages.values())
				.filter(
					(page) => page.workspaceId === workspaceId && page.deletedAt === null,
				)
				.sort((left, right) => left.position - right.position)
				.map(toMeta);
		},
		async listTrashedMetaByWorkspace(workspaceId: string) {
			return Array.from(pages.values())
				.filter(
					(page) => page.workspaceId === workspaceId && page.deletedAt !== null,
				)
				.sort((left, right) => left.position - right.position)
				.map(toMeta);
		},
		async findById(id: string) {
			return pages.get(id) ?? null;
		},
		async findMetaById(id: string) {
			const page = pages.get(id);
			return page ? toMeta(page) : null;
		},
		async searchByWorkspace(
			workspaceId: string,
			needle: string,
			limit: number,
		) {
			const lowered = needle.toLowerCase();
			return Array.from(pages.values())
				.filter(
					(page) =>
						page.workspaceId === workspaceId &&
						page.deletedAt === null &&
						(page.title.toLowerCase().includes(lowered) ||
							JSON.stringify(page.content).toLowerCase().includes(lowered)),
				)
				.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
				.slice(0, limit);
		},
		async listIdsByParent(parentPageId: string) {
			return Array.from(pages.values())
				.filter((page) => page.parentPageId === parentPageId)
				.map((page) => page.id);
		},
		async create(input: NewPage) {
			const now = new Date().toISOString();
			const page: Page = {
				id: crypto.randomUUID(),
				userId: input.userId,
				workspaceId: input.workspaceId,
				parentPageId: input.parentPageId,
				title: input.title,
				icon: null,
				position: input.position,
				content: [],
				deletedAt: null,
				createdAt: now,
				updatedAt: now,
			};
			pages.set(page.id, page);
			return toMeta(page);
		},
		async update(id: string, input: UpdatePageData) {
			const page = pages.get(id);
			if (!page) {
				throw new Error(`Page not found: ${id}`);
			}

			const next = { ...page, ...input, updatedAt: new Date().toISOString() };
			pages.set(id, next);
			return toMeta(next);
		},
		async saveContent(id: string, contentJson: string) {
			const page = pages.get(id);
			if (!page) {
				throw new Error(`Page not found: ${id}`);
			}

			const updatedAt = new Date().toISOString();
			pages.set(id, { ...page, content: JSON.parse(contentJson), updatedAt });
			return { updatedAt };
		},
		async saveContentIf(
			id: string,
			contentJson: string,
			baseUpdatedAt: string,
		) {
			const page = pages.get(id);
			if (!page) {
				throw new Error(`Page not found: ${id}`);
			}
			if (page.updatedAt !== baseUpdatedAt) {
				return null;
			}

			// Strictly after the base version, mirroring the drizzle repo.
			const updatedAt = new Date(
				Math.max(Date.now(), Date.parse(baseUpdatedAt) + 1),
			).toISOString();
			pages.set(id, { ...page, content: JSON.parse(contentJson), updatedAt });
			return { updatedAt };
		},
		async setDeletedByIds(ids: string[], deletedAt: string | null) {
			for (const id of ids) {
				const page = pages.get(id);
				if (page) {
					pages.set(id, {
						...page,
						deletedAt,
						updatedAt: new Date().toISOString(),
					});
				}
			}
		},
		async deleteByIds(ids: string[]) {
			for (const id of ids) {
				pages.delete(id);
			}
		},
		async deleteByWorkspace(workspaceId: string) {
			for (const page of Array.from(pages.values())) {
				if (page.workspaceId === workspaceId) {
					pages.delete(page.id);
				}
			}
		},
	};
}

export function createTestPageVersionRepository(): PageVersionRepository {
	const versions = new Map<string, PageVersion>();

	function metasByPage(pageId: string): PageVersion[] {
		return Array.from(versions.values())
			.filter((version) => version.pageId === pageId)
			.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
	}

	return {
		async listMetaByPage(pageId: string) {
			return metasByPage(pageId).map(({ content: _content, ...meta }) => ({
				...meta,
			}));
		},
		async findById(id: string) {
			return versions.get(id) ?? null;
		},
		async latestCreatedAt(pageId: string) {
			return metasByPage(pageId)[0]?.createdAt ?? null;
		},
		async create(input: NewPageVersion) {
			const version: PageVersion = {
				id: crypto.randomUUID(),
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
			const { content: _content, ...meta } = version;
			return meta;
		},
		async prune(pageId: string, keep: number) {
			for (const stale of metasByPage(pageId).slice(keep)) {
				versions.delete(stale.id);
			}
		},
	};
}

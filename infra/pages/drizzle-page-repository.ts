import "@beignet/core/server-only";
import * as Y from "yjs";
import { seedPageBody, projectPageBody } from "@/infra/documents/codec";
import { PageContentSchema } from "@/features/pages/schemas";
import { tenantScopeId } from "@beignet/core/ports";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import {
	and,
	asc,
	desc,
	eq,
	inArray,
	isNotNull,
	isNull,
	or,
	sql,
} from "drizzle-orm";
import { extractPageSearchText } from "@/features/pages/lib/extract-page-text";
import type {
	NewPage,
	PageRepository,
	UpdatePageData,
} from "@/features/pages/ports";
import type { BlockJson, Page, PageMeta } from "@/features/pages/schemas";
import * as schema from "@/infra/db/schema";
import { assertPageInScope } from "@/infra/db/tenant-scope";
import { appError } from "@/features/shared/errors";
import { createDrizzleDocumentRepository } from "@/infra/documents/drizzle-document-repository";

type PageRow = typeof schema.pages.$inferSelect;

const metaColumns = {
	id: schema.pages.id,
	userId: schema.pages.userId,
	workspaceId: schema.pages.workspaceId,
	parentPageId: schema.pages.parentPageId,
	title: schema.pages.title,
	icon: schema.pages.icon,
	position: schema.pages.position,
	deletedAt: schema.pages.deletedAt,
	createdAt: schema.pages.createdAt,
	updatedAt: schema.pages.updatedAt,
};

type PageMetaRow = Omit<PageRow, "content" | "searchText" | "contentUpdatedAt">;

function toPageMeta(row: PageMetaRow): PageMeta {
	return {
		id: row.id,
		userId: row.userId,
		workspaceId: row.workspaceId,
		parentPageId: row.parentPageId,
		title: row.title,
		icon: row.icon,
		position: row.position,
		deletedAt: row.deletedAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function toPage(row: PageRow): Page {
	return {
		...toPageMeta(row),
		content: JSON.parse(row.content) as BlockJson[],
		contentUpdatedAt: row.contentUpdatedAt,
	};
}

function searchTextForRow(
	row: Pick<PageRow, "content" | "searchText">,
): string {
	if (row.searchText.length > 0) return row.searchText;
	try {
		return extractPageSearchText(JSON.parse(row.content) as BlockJson[]);
	} catch {
		return "";
	}
}

export function createDrizzlePageRepository(
	db: DrizzleSqliteDatabase<typeof schema>,
): PageRepository {
	const repository: PageRepository = {
		async restoreContent(scope, id, content) {
			return createDrizzleDocumentRepository(db).restoreBody(
				scope,
				id,
				content,
			);
		},
		async appendContent(scope, id, blocks) {
			return createDrizzleDocumentRepository(db).appendBlocks(
				scope,
				id,
				blocks,
			);
		},
		async listMetaByWorkspace(scope) {
			const workspaceId = tenantScopeId(scope);
			const rows = await db
				.select(metaColumns)
				.from(schema.pages)
				.where(
					and(
						eq(schema.pages.workspaceId, workspaceId),
						isNull(schema.pages.deletedAt),
					),
				)
				.orderBy(asc(schema.pages.position));

			return rows.map(toPageMeta);
		},
		async listHierarchyByWorkspace(scope) {
			const workspaceId = tenantScopeId(scope);
			return db
				.select({
					id: schema.pages.id,
					parentPageId: schema.pages.parentPageId,
				})
				.from(schema.pages)
				.where(eq(schema.pages.workspaceId, workspaceId));
		},
		async listTrashedMetaByWorkspace(scope) {
			const workspaceId = tenantScopeId(scope);
			const rows = await db
				.select(metaColumns)
				.from(schema.pages)
				.where(
					and(
						eq(schema.pages.workspaceId, workspaceId),
						isNotNull(schema.pages.deletedAt),
					),
				)
				.orderBy(asc(schema.pages.position));

			return rows.map(toPageMeta);
		},
		async findById(scope, id: string) {
			const [row] = await db
				.select()
				.from(schema.pages)
				.where(
					and(
						eq(schema.pages.id, id),
						eq(schema.pages.workspaceId, tenantScopeId(scope)),
					),
				)
				.limit(1);

			return row ? toPage(row) : null;
		},
		async findMetaById(scope, id: string) {
			const [row] = await db
				.select(metaColumns)
				.from(schema.pages)
				.where(
					and(
						eq(schema.pages.id, id),
						eq(schema.pages.workspaceId, tenantScopeId(scope)),
					),
				)
				.limit(1);

			return row ? toPageMeta(row) : null;
		},
		async findMetaByIds(scope, ids: string[]) {
			if (ids.length === 0) return [];
			const rows = await db
				.select(metaColumns)
				.from(schema.pages)
				.where(
					and(
						inArray(schema.pages.id, ids),
						eq(schema.pages.workspaceId, tenantScopeId(scope)),
					),
				);

			return rows.map(toPageMeta);
		},
		async searchByWorkspace(scope, needle: string, limit: number) {
			const workspaceId = tenantScopeId(scope);
			const pattern = `%${needle.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
			const rows = await db
				.select({
					...metaColumns,
					content: schema.pages.content,
					searchText: schema.pages.searchText,
				})
				.from(schema.pages)
				.where(
					and(
						eq(schema.pages.workspaceId, workspaceId),
						isNull(schema.pages.deletedAt),
						or(
							sql`${schema.pages.title} LIKE ${pattern} ESCAPE '\\'`,
							sql`${schema.pages.searchText} LIKE ${pattern} ESCAPE '\\'`,
							and(
								eq(schema.pages.searchText, ""),
								sql`${schema.pages.content} LIKE ${pattern} ESCAPE '\\'`,
							),
						),
					),
				)
				.orderBy(desc(schema.pages.updatedAt))
				.limit(limit);

			return rows.map((row) => ({
				...toPageMeta(row),
				searchText: searchTextForRow(row),
			}));
		},
		async listIdsByParent(scope, parentPageId: string) {
			const rows = await db
				.select({ id: schema.pages.id })
				.from(schema.pages)
				.where(
					and(
						eq(schema.pages.parentPageId, parentPageId),
						eq(schema.pages.workspaceId, tenantScopeId(scope)),
					),
				);

			return rows.map((row) => row.id);
		},
		async maxPositionForParent(scope, parentPageId: string | null) {
			const workspaceId = tenantScopeId(scope);
			const [row] = await db
				.select({
					position: sql<number | null>`max(${schema.pages.position})`,
				})
				.from(schema.pages)
				.where(
					and(
						eq(schema.pages.workspaceId, workspaceId),
						isNull(schema.pages.deletedAt),
						parentPageId === null
							? isNull(schema.pages.parentPageId)
							: eq(schema.pages.parentPageId, parentPageId),
					),
				);

			return row?.position ?? 0;
		},
		async create(scope, input: NewPage) {
			const doc = seedPageBody(
				PageContentSchema.parse(input.initialContent ?? []),
			);
			try {
				const content = PageContentSchema.parse(projectPageBody(doc));
				const state = Y.encodeStateAsUpdate(doc);
				return await db.transaction(async (tx) => {
					if (input.parentPageId !== null)
						await assertPageInScope(tx, scope, input.parentPageId);
					const now = new Date().toISOString();
					const [row] = await tx
						.insert(schema.pages)
						.values({
							id: crypto.randomUUID(),
							userId: input.userId,
							workspaceId: tenantScopeId(scope),
							parentPageId: input.parentPageId,
							title: input.title,
							icon: null,
							position: input.position,
							content: JSON.stringify(content),
							searchText: extractPageSearchText(content),
							contentUpdatedAt: now,
							createdAt: now,
							updatedAt: now,
						})
						.returning();
					if (!row) throw new Error("Failed to create page");
					await createDrizzleDocumentRepository(tx).insert(
						scope,
						row.id,
						state,
					);
					return { ...toPageMeta(row), contentUpdatedAt: row.contentUpdatedAt };
				});
			} finally {
				doc.destroy();
			}
		},
		async update(scope, id: string, input: UpdatePageData) {
			if (input.parentPageId !== undefined && input.parentPageId !== null) {
				await assertPageInScope(db, scope, input.parentPageId);
			}
			const [row] = await db
				.update(schema.pages)
				.set({ ...input, updatedAt: new Date().toISOString() })
				.where(
					and(
						eq(schema.pages.id, id),
						eq(schema.pages.workspaceId, tenantScopeId(scope)),
					),
				)
				.returning(metaColumns);

			if (!row) {
				throw new Error(`Failed to update page ${id}`);
			}

			return toPageMeta(row);
		},
		async updateIfTitle(scope, id, input, baseTitle) {
			if (input.parentPageId !== undefined && input.parentPageId !== null) {
				await assertPageInScope(db, scope, input.parentPageId);
			}
			const [row] = await db
				.update(schema.pages)
				.set({ ...input, updatedAt: new Date().toISOString() })
				.where(
					and(
						eq(schema.pages.id, id),
						eq(schema.pages.workspaceId, tenantScopeId(scope)),
						eq(schema.pages.title, baseTitle),
					),
				)
				.returning(metaColumns);
			return row ? toPageMeta(row) : null;
		},
		async setDeletedByIds(scope, ids: string[], deletedAt: string | null) {
			if (ids.length === 0) return;
			await db
				.update(schema.pages)
				.set({ deletedAt, updatedAt: new Date().toISOString() })
				.where(
					and(
						inArray(schema.pages.id, ids),
						eq(schema.pages.workspaceId, tenantScopeId(scope)),
					),
				);
		},
		async deleteByIds(scope, ids: string[]) {
			if (ids.length === 0) return;
			await db
				.delete(schema.pages)
				.where(
					and(
						inArray(schema.pages.id, ids),
						eq(schema.pages.workspaceId, tenantScopeId(scope)),
					),
				);
		},
		async deleteByWorkspace(scope) {
			await db
				.delete(schema.pages)
				.where(eq(schema.pages.workspaceId, tenantScopeId(scope)));
		},
	};
	return repository;
}

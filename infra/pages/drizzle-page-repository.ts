import "@beignet/core/server-only";
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
import type {
	NewPage,
	PageRepository,
	UpdatePageData,
} from "@/features/pages/ports";
import type { BlockJson, Page, PageMeta } from "@/features/pages/schemas";
import { extractPageSearchText } from "@/features/pages/lib/extract-page-text";
import * as schema from "@/infra/db/schema";

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

type PageMetaRow = Omit<PageRow, "content" | "searchText">;

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
	return {
		async listMetaByWorkspace(workspaceId: string) {
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
		async listHierarchyByWorkspace(workspaceId: string) {
			return db
				.select({
					id: schema.pages.id,
					parentPageId: schema.pages.parentPageId,
				})
				.from(schema.pages)
				.where(eq(schema.pages.workspaceId, workspaceId));
		},
		async listTrashedMetaByWorkspace(workspaceId: string) {
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
		async findById(id: string) {
			const [row] = await db
				.select()
				.from(schema.pages)
				.where(eq(schema.pages.id, id))
				.limit(1);

			return row ? toPage(row) : null;
		},
		async findMetaById(id: string) {
			const [row] = await db
				.select(metaColumns)
				.from(schema.pages)
				.where(eq(schema.pages.id, id))
				.limit(1);

			return row ? toPageMeta(row) : null;
		},
		async findMetaByIds(ids: string[]) {
			if (ids.length === 0) return [];
			const rows = await db
				.select(metaColumns)
				.from(schema.pages)
				.where(inArray(schema.pages.id, ids));

			return rows.map(toPageMeta);
		},
		async searchByWorkspace(
			workspaceId: string,
			needle: string,
			limit: number,
		) {
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
		async listIdsByParent(parentPageId: string) {
			const rows = await db
				.select({ id: schema.pages.id })
				.from(schema.pages)
				.where(eq(schema.pages.parentPageId, parentPageId));

			return rows.map((row) => row.id);
		},
		async maxPositionForParent(
			workspaceId: string,
			parentPageId: string | null,
		) {
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
		async create(input: NewPage) {
			const now = new Date().toISOString();
			const page = {
				id: crypto.randomUUID(),
				userId: input.userId,
				workspaceId: input.workspaceId,
				parentPageId: input.parentPageId,
				title: input.title,
				icon: null,
				position: input.position,
				content: "[]",
				searchText: "",
				createdAt: now,
				updatedAt: now,
			};
			const [row] = await db.insert(schema.pages).values(page).returning();

			if (!row) {
				throw new Error("Failed to create page");
			}

			return toPageMeta(row);
		},
		async update(id: string, input: UpdatePageData) {
			const [row] = await db
				.update(schema.pages)
				.set({ ...input, updatedAt: new Date().toISOString() })
				.where(eq(schema.pages.id, id))
				.returning(metaColumns);

			if (!row) {
				throw new Error(`Failed to update page ${id}`);
			}

			return toPageMeta(row);
		},
		async saveContent(id: string, contentJson: string, searchText: string) {
			const [current] = await db
				.select({ updatedAt: schema.pages.updatedAt })
				.from(schema.pages)
				.where(eq(schema.pages.id, id))
				.limit(1);
			if (!current) {
				throw new Error(`Failed to save content for page ${id}`);
			}

			// Strictly after the previous version: write-through saves without a
			// CAS base must still invalidate any editor holding that base.
			const updatedAt = new Date(
				Math.max(Date.now(), Date.parse(current.updatedAt) + 1),
			).toISOString();
			const [row] = await db
				.update(schema.pages)
				.set({ content: contentJson, searchText, updatedAt })
				.where(eq(schema.pages.id, id))
				.returning({ id: schema.pages.id });

			if (!row) {
				throw new Error(`Failed to save content for page ${id}`);
			}

			return { updatedAt };
		},
		async saveContentIf(
			id: string,
			contentJson: string,
			searchText: string,
			baseUpdatedAt: string,
		) {
			// Strictly after the base version: two writes inside the same
			// millisecond must still produce distinct versions, or the next
			// stale write would slip past the compare-and-set.
			const updatedAt = new Date(
				Math.max(Date.now(), Date.parse(baseUpdatedAt) + 1),
			).toISOString();
			// The WHERE clause is the compare-and-set: no row updates when
			// another writer already bumped updatedAt.
			const [row] = await db
				.update(schema.pages)
				.set({ content: contentJson, searchText, updatedAt })
				.where(
					and(
						eq(schema.pages.id, id),
						eq(schema.pages.updatedAt, baseUpdatedAt),
					),
				)
				.returning({ id: schema.pages.id });

			return row ? { updatedAt } : null;
		},
		async setDeletedByIds(ids: string[], deletedAt: string | null) {
			if (ids.length === 0) return;
			await db
				.update(schema.pages)
				.set({ deletedAt, updatedAt: new Date().toISOString() })
				.where(inArray(schema.pages.id, ids));
		},
		async deleteByIds(ids: string[]) {
			if (ids.length === 0) return;
			await db.delete(schema.pages).where(inArray(schema.pages.id, ids));
		},
		async deleteByWorkspace(workspaceId: string) {
			await db
				.delete(schema.pages)
				.where(eq(schema.pages.workspaceId, workspaceId));
		},
	};
}

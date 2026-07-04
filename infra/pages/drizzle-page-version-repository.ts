import "@beignet/core/server-only";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { desc, eq, inArray, sql } from "drizzle-orm";
import type {
	NewPageVersion,
	PageVersionRepository,
} from "@/features/pages/ports";
import type {
	BlockJson,
	PageVersion,
	PageVersionMeta,
} from "@/features/pages/schemas";
import * as schema from "@/infra/db/schema";

type VersionRow = typeof schema.pageVersions.$inferSelect;

function toMeta(
	row: Omit<VersionRow, "content">,
	createdByName: string | null,
): PageVersionMeta {
	return {
		id: row.id,
		pageId: row.pageId,
		title: row.title,
		icon: row.icon,
		cause: row.cause === "restore" ? "restore" : "checkpoint",
		createdBy: row.createdBy,
		createdByName,
		createdAt: row.createdAt,
	};
}

const metaColumns = {
	id: schema.pageVersions.id,
	pageId: schema.pageVersions.pageId,
	workspaceId: schema.pageVersions.workspaceId,
	title: schema.pageVersions.title,
	icon: schema.pageVersions.icon,
	cause: schema.pageVersions.cause,
	createdBy: schema.pageVersions.createdBy,
	createdAt: schema.pageVersions.createdAt,
};

export function createDrizzlePageVersionRepository(
	db: DrizzleSqliteDatabase<typeof schema>,
): PageVersionRepository {
	return {
		async listMetaByPage(pageId: string) {
			const rows = await db
				.select({
					version: metaColumns,
					// OTP sign-ups can have an empty name; fall back to the email.
					createdByName: sql<
						string | null
					>`COALESCE(NULLIF(${schema.user.name}, ''), ${schema.user.email})`,
				})
				.from(schema.pageVersions)
				.leftJoin(
					schema.user,
					eq(schema.pageVersions.createdBy, schema.user.id),
				)
				.where(eq(schema.pageVersions.pageId, pageId))
				.orderBy(desc(schema.pageVersions.createdAt));

			return rows.map((row) => toMeta(row.version, row.createdByName));
		},
		async findById(id: string): Promise<PageVersion | null> {
			const [row] = await db
				.select()
				.from(schema.pageVersions)
				.where(eq(schema.pageVersions.id, id))
				.limit(1);

			if (!row) return null;
			return {
				...toMeta(row, null),
				content: JSON.parse(row.content) as BlockJson[],
			};
		},
		async latestCreatedAt(pageId: string) {
			const [row] = await db
				.select({ createdAt: schema.pageVersions.createdAt })
				.from(schema.pageVersions)
				.where(eq(schema.pageVersions.pageId, pageId))
				.orderBy(desc(schema.pageVersions.createdAt))
				.limit(1);

			return row?.createdAt ?? null;
		},
		async create(input: NewPageVersion) {
			const version = {
				id: crypto.randomUUID(),
				pageId: input.pageId,
				workspaceId: input.workspaceId,
				title: input.title,
				icon: input.icon,
				content: input.contentJson,
				cause: input.cause,
				createdBy: input.createdBy,
				createdAt: new Date().toISOString(),
			};
			const [row] = await db
				.insert(schema.pageVersions)
				.values(version)
				.returning();

			if (!row) {
				throw new Error("Failed to create page version");
			}

			return toMeta(row, null);
		},
		async prune(pageId: string, keep: number) {
			// SQLite can't OFFSET without LIMIT (and drizzle drops limit(-1)),
			// so slice in JS — retention keeps this list ~50 rows at most.
			const rows = await db
				.select({ id: schema.pageVersions.id })
				.from(schema.pageVersions)
				.where(eq(schema.pageVersions.pageId, pageId))
				.orderBy(desc(schema.pageVersions.createdAt));
			const stale = rows.slice(keep);

			if (stale.length > 0) {
				await db.delete(schema.pageVersions).where(
					inArray(
						schema.pageVersions.id,
						stale.map((row) => row.id),
					),
				);
			}
		},
	};
}

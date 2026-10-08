import "@beignet/core/server-only";
import { tenantScopeId } from "@beignet/core/ports";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { sql } from "drizzle-orm";
import type {
	SearchRow,
	WorkspaceSearchRepository,
} from "@/features/search/ports";
import type * as schema from "@/infra/db/schema";

export function createWorkspaceSearchRepository(
	db: DrizzleSqliteDatabase<typeof schema>,
): WorkspaceSearchRepository {
	return {
		async search(scope, { query, kind, limit, after }) {
			const workspaceId = tenantScopeId(scope);
			const pattern = `%${query.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
			const page = sql`SELECT 'page' kind, p.id, p.title, p.icon,
				p.parent_page_id pageId, parent.title pageTitle,
				COALESCE(NULLIF(p.search_text, ''), (
                    SELECT group_concat(block_text, char(10)) FROM (
                        SELECT (SELECT group_concat(node.atom, '')
                            FROM json_tree(block.value, '$.content') node
                            WHERE node.key = 'text' AND node.type = 'text') block_text
                        FROM json_tree(p.content) block
                        WHERE block.type = 'object' AND json_type(block.value, '$.id') = 'text'
                            AND json_type(block.value, '$.type') = 'text'
                    )
                ), '') text, NULL shapeId, NULL completed, p.updated_at updatedAt
				FROM pages p LEFT JOIN pages parent ON parent.id = p.parent_page_id
				AND parent.workspace_id = p.workspace_id AND parent.deleted_at IS NULL
				WHERE p.workspace_id = ${workspaceId} AND p.deleted_at IS NULL`;
			const task = sql`SELECT 'task' kind, t.id, t.title, NULL icon,
				t.page_id pageId, p.title pageTitle, '' text, NULL shapeId,
				t.completed, t.updated_at updatedAt
				FROM tasks t LEFT JOIN pages p ON p.id = t.page_id AND p.workspace_id = t.workspace_id
				WHERE t.workspace_id = ${workspaceId}
				AND (t.page_id IS NULL OR (p.id IS NOT NULL AND p.deleted_at IS NULL))`;
			const canvas = sql`SELECT 'canvas' kind, c.id, COALESCE(NULLIF(c.title, ''), 'Untitled canvas') title,
				NULL icon, c.page_id pageId, p.title pageTitle,
				COALESCE(json_extract(contentMatch, '$.text'), '') text,
				json_extract(contentMatch, '$.shapeId') shapeId, NULL completed, c.updated_at updatedAt
				FROM (SELECT c.*, (SELECT value FROM json_each(c.search_content)
					WHERE json_extract(value, '$.text') LIKE ${pattern} ESCAPE '\\'
					ORDER BY json_extract(value, '$.shapeId') LIMIT 1) AS contentMatch
					FROM canvases c WHERE c.workspace_id = ${workspaceId}) c
				LEFT JOIN pages p ON p.id = c.page_id AND p.workspace_id = c.workspace_id
				WHERE c.page_id IS NULL OR (p.id IS NOT NULL AND p.deleted_at IS NULL
                    AND EXISTS (SELECT 1 FROM json_tree(p.content) block
                        WHERE block.type = 'object' AND json_extract(block.value, '$.type') = 'canvas'
                            AND json_extract(block.value, '$.props.canvasId') = c.id))`;
			const sources =
				kind === "all" ? [page, task, canvas] : [{ page, task, canvas }[kind]];
			const continuation = after
				? sql`WHERE
				rank > ${after.rank} OR (rank = ${after.rank} AND (
				updatedAt < ${after.updatedAt} OR (updatedAt = ${after.updatedAt} AND (
				kind > ${after.kind} OR (kind = ${after.kind} AND id > ${after.id})))))`
				: sql``;
			const rows = await db.all<
				Omit<SearchRow, "completed"> & { completed: number | null }
			>(sql`
				WITH resources AS (${sql.join(sources, sql` UNION ALL `)}),
				matches AS (SELECT *, CASE WHEN title LIKE ${pattern} ESCAPE '\\' THEN 0 ELSE 1 END rank
					FROM resources WHERE title LIKE ${pattern} ESCAPE '\\' OR text LIKE ${pattern} ESCAPE '\\')
				SELECT * FROM matches ${continuation}
				ORDER BY rank ASC, updatedAt DESC, kind ASC, id ASC LIMIT ${limit}
			`);
			return rows.map((row) => ({
				...row,
				completed: row.completed === null ? null : Boolean(row.completed),
			}));
		},
	};
}

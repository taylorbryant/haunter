import "@beignet/core/server-only";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { asc, eq } from "drizzle-orm";
import type {
	NewWorkspace,
	UpdateWorkspaceData,
	WorkspaceRepository,
} from "@/features/workspaces/ports";
import type { Workspace } from "@/features/workspaces/schemas";
import * as schema from "@/infra/db/schema";

type WorkspaceRow = typeof schema.workspaces.$inferSelect;

function toWorkspace(row: WorkspaceRow): Workspace {
	return {
		id: row.id,
		userId: row.userId,
		name: row.name,
		icon: row.icon,
		position: row.position,
		createdAt: row.createdAt,
	};
}

export function createDrizzleWorkspaceRepository(
	db: DrizzleSqliteDatabase<typeof schema>,
): WorkspaceRepository {
	return {
		async listByUser(userId: string) {
			const rows = await db
				.select()
				.from(schema.workspaces)
				.where(eq(schema.workspaces.userId, userId))
				.orderBy(asc(schema.workspaces.position));

			return rows.map(toWorkspace);
		},
		async findById(id: string) {
			const [row] = await db
				.select()
				.from(schema.workspaces)
				.where(eq(schema.workspaces.id, id))
				.limit(1);

			return row ? toWorkspace(row) : null;
		},
		async create(input: NewWorkspace) {
			const workspace = {
				id: crypto.randomUUID(),
				userId: input.userId,
				name: input.name,
				icon: input.icon,
				position: input.position,
				createdAt: new Date().toISOString(),
			};
			const [row] = await db
				.insert(schema.workspaces)
				.values(workspace)
				.returning();

			if (!row) {
				throw new Error("Failed to create workspace");
			}

			return toWorkspace(row);
		},
		async update(id: string, input: UpdateWorkspaceData) {
			const [row] = await db
				.update(schema.workspaces)
				.set(input)
				.where(eq(schema.workspaces.id, id))
				.returning();

			if (!row) {
				throw new Error(`Failed to update workspace ${id}`);
			}

			return toWorkspace(row);
		},
		async delete(id: string) {
			await db.delete(schema.workspaces).where(eq(schema.workspaces.id, id));
		},
	};
}

import "@beignet/core/server-only";
import { type TenantScope, tenantScopeId } from "@beignet/core/ports";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { and, eq } from "drizzle-orm";
import * as schema from "./schema";

/** Ensure a page-owned row cannot point across the repository tenant boundary. */
export async function assertPageInScope(
	db: DrizzleSqliteDatabase<typeof schema>,
	scope: TenantScope,
	pageId: string,
): Promise<void> {
	const [page] = await db
		.select({ id: schema.pages.id })
		.from(schema.pages)
		.where(
			and(
				eq(schema.pages.id, pageId),
				eq(schema.pages.workspaceId, tenantScopeId(scope)),
			),
		)
		.limit(1);

	if (!page) {
		throw new Error(`Page ${pageId} is outside the tenant scope`);
	}
}

/** Ensure a canvas-owned row cannot point across the repository tenant boundary. */
export async function assertCanvasInScope(
	db: DrizzleSqliteDatabase<typeof schema>,
	scope: TenantScope,
	canvasId: string,
): Promise<void> {
	const [canvas] = await db
		.select({ id: schema.canvases.id })
		.from(schema.canvases)
		.where(
			and(
				eq(schema.canvases.id, canvasId),
				eq(schema.canvases.workspaceId, tenantScopeId(scope)),
			),
		)
		.limit(1);

	if (!canvas) {
		throw new Error(`Canvas ${canvasId} is outside the tenant scope`);
	}
}

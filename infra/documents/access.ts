import { and, eq, gt, isNull, or } from "drizzle-orm";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import type { DocumentGrant } from "@/features/documents/ports";
import { databaseClient } from "@/infra/db/client";
import * as schema from "@/infra/db/schema";
import { DocumentRestoredError } from "@/features/documents/restoration";

/** Recheck the live session, page and membership; signed claims are selectors. */
export async function checkDocumentAccess(
	grant: DocumentGrant,
	db: LibSQLDatabase<typeof schema> = drizzle(databaseClient, { schema }),
): Promise<string> {
	if (grant.expiresAt <= Date.now())
		throw new Error("Document session expired");
	if (grant.kind === "canvas") return checkCanvasAccess(grant, db);
	const [row] = await db
		.select({ role: schema.member.role })
		.from(schema.session)
		.innerJoin(schema.user, eq(schema.user.id, schema.session.userId))
		.innerJoin(
			schema.member,
			and(
				eq(schema.member.userId, schema.user.id),
				eq(schema.member.organizationId, grant.workspaceId),
			),
		)
		.innerJoin(
			schema.pages,
			and(
				eq(schema.pages.workspaceId, grant.workspaceId),
				eq(schema.pages.id, grant.pageId),
			),
		)
		.where(
			and(
				eq(schema.session.id, grant.sessionId),
				eq(schema.session.userId, grant.userId),
				gt(schema.session.expiresAt, new Date()),
				isNull(schema.pages.deletedAt),
				or(isNull(schema.user.banned), eq(schema.user.banned, false)),
			),
		);
	if (!row) throw new Error("Document access is no longer available");
	const [document] = await db
		.select({ generation: schema.collaborativeDocuments.generation })
		.from(schema.collaborativeDocuments)
		.where(
			and(
				eq(schema.collaborativeDocuments.pageId, grant.pageId),
				eq(schema.collaborativeDocuments.workspaceId, grant.workspaceId),
			),
		);
	if (!document) throw new Error("Page body has not been migrated");
	if (document.generation !== grant.generation)
		throw new DocumentRestoredError(document.generation);
	return row.role;
}

async function checkCanvasAccess(
	grant: DocumentGrant,
	db: LibSQLDatabase<typeof schema>,
): Promise<string> {
	const [row] = await db
		.select({ role: schema.member.role, pageId: schema.canvases.pageId })
		.from(schema.session)
		.innerJoin(schema.user, eq(schema.user.id, schema.session.userId))
		.innerJoin(
			schema.member,
			and(
				eq(schema.member.userId, schema.user.id),
				eq(schema.member.organizationId, grant.workspaceId),
			),
		)
		.innerJoin(
			schema.canvases,
			and(
				eq(schema.canvases.workspaceId, grant.workspaceId),
				eq(schema.canvases.id, grant.pageId),
			),
		)
		.innerJoin(
			schema.canvasSyncRooms,
			and(
				eq(schema.canvasSyncRooms.canvasId, schema.canvases.id),
				eq(schema.canvasSyncRooms.workspaceId, grant.workspaceId),
			),
		)
		.where(
			and(
				eq(schema.session.id, grant.sessionId),
				eq(schema.session.userId, grant.userId),
				gt(schema.session.expiresAt, new Date()),
				or(isNull(schema.user.banned), eq(schema.user.banned, false)),
			),
		);
	if (!row || grant.generation !== 0)
		throw new Error("Canvas access is no longer available");
	if (row.pageId) {
		const [page] = await db
			.select({ id: schema.pages.id })
			.from(schema.pages)
			.where(
				and(
					eq(schema.pages.id, row.pageId),
					eq(schema.pages.workspaceId, grant.workspaceId),
					isNull(schema.pages.deletedAt),
				),
			);
		if (!page) throw new Error("Canvas page is unavailable");
	}
	return row.role;
}

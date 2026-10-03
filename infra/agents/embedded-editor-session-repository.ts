import "@beignet/core/server-only";
import { createHash, randomBytes } from "node:crypto";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import type { EmbeddedEditorSessionPort } from "@/features/agents/embedded-editor-session";
import { canEditContent } from "@/lib/org-roles";
import * as schema from "@/infra/db/schema";
import { createDrizzleMcpConnectionRepository } from "./drizzle-mcp-connection-repository";

const hash = (value: string) =>
	createHash("sha256").update(value).digest("base64url");

export function createEmbeddedEditorSessionRepository(
	db: DrizzleSqliteDatabase<typeof schema>,
): EmbeddedEditorSessionPort {
	const table = schema.embeddedEditorSession;
	async function findActive(id: string) {
		const [row] = await db
			.select({
				session: table,
				clientId: schema.mcpConnection.clientId,
				role: schema.member.role,
				user: {
					id: schema.user.id,
					name: schema.user.name,
					email: schema.user.email,
					image: schema.user.image,
				},
			})
			.from(table)
			.innerJoin(
				schema.mcpConnection,
				and(
					eq(schema.mcpConnection.id, table.connectionId),
					eq(schema.mcpConnection.userId, table.userId),
				),
			)
			.innerJoin(schema.user, eq(schema.user.id, table.userId))
			.innerJoin(
				schema.member,
				and(
					eq(schema.member.userId, table.userId),
					eq(schema.member.organizationId, table.workspaceId),
				),
			)
			.innerJoin(
				schema.pages,
				and(
					eq(schema.pages.id, table.pageId),
					eq(schema.pages.workspaceId, table.workspaceId),
				),
			)
			.where(
				and(
					eq(table.id, id),
					gt(table.expiresAt, new Date()),
					isNull(schema.pages.deletedAt),
					or(isNull(schema.user.banned), eq(schema.user.banned, false)),
					eq(schema.user.accessStatus, "approved"),
				),
			)
			.limit(1);
		if (!row || !row.session.credentialHash) return null;
		const connection = await createDrizzleMcpConnectionRepository(
			db,
		).findActive(row.user.id, row.clientId);
		if (
			!connection ||
			connection.id !== row.session.connectionId ||
			!connection.workspaceIds.includes(row.session.workspaceId)
		)
			return null;
		const writable =
			row.session.writable &&
			connection.embeddedEditorAccess === "edit" &&
			connection.permissionProfile !== "view" &&
			canEditContent(row.role);
		return {
			id: row.session.id,
			connectionId: row.session.connectionId,
			workspaceId: row.session.workspaceId,
			pageId: row.session.pageId,
			expiresAt: row.session.expiresAt.getTime(),
			role: writable ? row.role : "viewer",
			user: row.user,
		};
	}
	return {
		async create(input) {
			await db.delete(table).where(lt(table.expiresAt, new Date()));
			const id = crypto.randomUUID();
			await db.insert(table).values({
				...input,
				id,
				redeemBy: new Date(Date.now() + 60_000),
				expiresAt: new Date(Date.now() + 5 * 60_000),
			});
			return { id };
		},
		async exchange({ id, proofSecret }) {
			const token = randomBytes(32).toString("base64url");
			// Atomic consumption across replicas. The public handoff ID alone cannot
			// redeem; the verifier never passes through the host or MCP result.
			const [consumed] = await db
				.update(table)
				.set({ credentialHash: hash(token) })
				.where(
					and(
						eq(table.id, id),
						eq(table.challenge, hash(proofSecret)),
						isNull(table.credentialHash),
						gt(table.redeemBy, new Date()),
					),
				)
				.returning({ id: table.id });
			if (!consumed) return null;
			const identity = await findActive(id);
			return identity ? { token, identity } : null;
		},
		async authenticate(token) {
			if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
			const [row] = await db
				.select({ id: table.id })
				.from(table)
				.where(eq(table.credentialHash, hash(token)))
				.limit(1);
			return row ? findActive(row.id) : null;
		},
		findActive,
	};
}

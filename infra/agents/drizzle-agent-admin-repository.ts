import "@beignet/core/server-only";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type {
	AgentActivityWrite,
	AgentAdminRepository,
	AgentAdminRow,
} from "@/features/agents/ports";
import * as schema from "@/infra/db/schema";

type AgentRecord = {
	id: string;
	name: string;
	mode: string;
	status: string;
	userId: string | null;
	hostName: string | null;
	lastUsedAt: Date | null;
	createdAt: Date;
};

export function createDrizzleAgentAdminRepository(
	db: DrizzleSqliteDatabase<typeof schema>,
): AgentAdminRepository {
	async function grantsByAgent(agentIds: string[]) {
		if (agentIds.length === 0) {
			return new Map<string, AgentAdminRow["grants"]>();
		}
		const rows = await db
			.select({
				agentId: schema.agentCapabilityGrant.agentId,
				capability: schema.agentCapabilityGrant.capability,
				status: schema.agentCapabilityGrant.status,
			})
			.from(schema.agentCapabilityGrant)
			.where(inArray(schema.agentCapabilityGrant.agentId, agentIds));

		const byAgent = new Map<string, AgentAdminRow["grants"]>();
		for (const row of rows) {
			const grants = byAgent.get(row.agentId) ?? [];
			grants.push({ capability: row.capability, status: row.status });
			byAgent.set(row.agentId, grants);
		}
		return byAgent;
	}

	function toRow(
		record: AgentRecord,
		grants: AgentAdminRow["grants"],
	): AgentAdminRow {
		return { ...record, grants };
	}

	const agentColumns = {
		id: schema.agent.id,
		name: schema.agent.name,
		mode: schema.agent.mode,
		status: schema.agent.status,
		userId: schema.agent.userId,
		hostName: schema.agentHost.name,
		lastUsedAt: schema.agent.lastUsedAt,
		createdAt: schema.agent.createdAt,
	};

	return {
		async listByUser(userId: string) {
			const records = await db
				.select(agentColumns)
				.from(schema.agent)
				.leftJoin(
					schema.agentHost,
					eq(schema.agent.hostId, schema.agentHost.id),
				)
				.where(eq(schema.agent.userId, userId))
				.orderBy(desc(schema.agent.createdAt));

			const grants = await grantsByAgent(records.map((r) => r.id));
			return records.map((record) =>
				toRow(record, grants.get(record.id) ?? []),
			);
		},
		async findAwaitingApprovalById(agentId: string) {
			const [record] = await db
				.select(agentColumns)
				.from(schema.agent)
				.leftJoin(
					schema.agentHost,
					eq(schema.agent.hostId, schema.agentHost.id),
				)
				.where(
					and(
						eq(schema.agent.id, agentId),
						inArray(schema.agent.status, ["pending", "active"]),
					),
				)
				.limit(1);

			if (!record) return null;
			const grants = await grantsByAgent([record.id]);
			const agentGrants = grants.get(record.id) ?? [];
			if (!agentGrants.some((grant) => grant.status === "pending")) return null;
			return toRow(record, agentGrants);
		},
		async recordActivity(activity: AgentActivityWrite) {
			await db.insert(schema.agentActivity).values(activity);
			await db
				.delete(schema.agentActivity)
				.where(
					and(
						eq(schema.agentActivity.userId, activity.userId),
						lt(
							schema.agentActivity.createdAt,
							new Date(activity.createdAt.getTime() - 90 * 24 * 60 * 60 * 1000),
						),
					),
				);
		},
		async listRecentActivityByUser(userId: string, limit: number) {
			return db
				.select({
					id: schema.agentActivity.id,
					agentId: schema.agentActivity.agentId,
					agentName: schema.agent.name,
					userId: schema.agentActivity.userId,
					workspaceId: schema.agentActivity.workspaceId,
					capability: schema.agentActivity.capability,
					status: schema.agentActivity.status,
					resourceType: schema.agentActivity.resourceType,
					resourceId: schema.agentActivity.resourceId,
					resourceLabel: schema.agentActivity.resourceLabel,
					durationMs: schema.agentActivity.durationMs,
					error: schema.agentActivity.error,
					createdAt: schema.agentActivity.createdAt,
				})
				.from(schema.agentActivity)
				.innerJoin(
					schema.agent,
					eq(schema.agentActivity.agentId, schema.agent.id),
				)
				.where(eq(schema.agentActivity.userId, userId))
				.orderBy(desc(schema.agentActivity.createdAt))
				.limit(limit);
		},
	};
}

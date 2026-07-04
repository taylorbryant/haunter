import "@beignet/core/server-only";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { and, desc, eq, inArray } from "drizzle-orm";
import type {
	AgentAdminRepository,
	AgentAdminRow,
} from "@/features/agents/ports";
import * as schema from "@/infra/db/schema";

type AgentRecord = {
	id: string;
	name: string;
	mode: string;
	status: string;
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
		async findPendingById(agentId: string) {
			const [record] = await db
				.select(agentColumns)
				.from(schema.agent)
				.leftJoin(
					schema.agentHost,
					eq(schema.agent.hostId, schema.agentHost.id),
				)
				.where(
					and(eq(schema.agent.id, agentId), eq(schema.agent.status, "pending")),
				)
				.limit(1);

			if (!record) return null;
			const grants = await grantsByAgent([record.id]);
			return toRow(record, grants.get(record.id) ?? []);
		},
	};
}

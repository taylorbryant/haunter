import "@beignet/core/server-only";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
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
	hostId: string;
	hostName: string | null;
	hostStatus: string | null;
	hostDefaultCapabilities: string | null;
	lastUsedAt: Date | null;
	createdAt: Date;
};

function parseCapabilityIds(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter(
			(capability): capability is string => typeof capability === "string",
		);
	}
	if (typeof value !== "string" || value.length === 0) return [];

	try {
		let parsed: unknown = JSON.parse(value);
		if (typeof parsed === "string") parsed = JSON.parse(parsed);
		return Array.isArray(parsed)
			? parsed.filter(
					(capability): capability is string => typeof capability === "string",
				)
			: [];
	} catch {
		return [];
	}
}

function parseGrantConstraints(value: unknown): Record<string, unknown> | null {
	if (value === null || value === undefined) return null;
	if (typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	if (typeof value !== "string") return null;

	try {
		const parsed: unknown = JSON.parse(value);
		return parsed !== null &&
			typeof parsed === "object" &&
			!Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

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
				constraints: schema.agentCapabilityGrant.constraints,
			})
			.from(schema.agentCapabilityGrant)
			.where(inArray(schema.agentCapabilityGrant.agentId, agentIds));

		const byAgent = new Map<string, AgentAdminRow["grants"]>();
		for (const row of rows) {
			const grants = byAgent.get(row.agentId) ?? [];
			grants.push({
				capability: row.capability,
				status: row.status,
				constraints: parseGrantConstraints(row.constraints),
			});
			byAgent.set(row.agentId, grants);
		}
		return byAgent;
	}

	function toRow(
		record: AgentRecord,
		grants: AgentAdminRow["grants"],
	): AgentAdminRow {
		const { hostDefaultCapabilities, ...agent } = record;
		return {
			...agent,
			hostDefaultCapabilities: parseCapabilityIds(hostDefaultCapabilities),
			grants,
		};
	}

	const agentColumns = {
		id: schema.agent.id,
		name: schema.agent.name,
		mode: schema.agent.mode,
		status: schema.agent.status,
		userId: schema.agent.userId,
		hostId: schema.agent.hostId,
		hostName: schema.agentHost.name,
		hostStatus: schema.agentHost.status,
		hostDefaultCapabilities: schema.agentHost.defaultCapabilities,
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
		async findCurrentApprovalIdByAgentId(agentId: string, now: Date) {
			const [approval] = await db
				.select({ id: schema.approvalRequest.id })
				.from(schema.approvalRequest)
				.where(
					and(
						eq(schema.approvalRequest.agentId, agentId),
						eq(schema.approvalRequest.status, "pending"),
						eq(schema.approvalRequest.method, "device_authorization"),
						gte(schema.approvalRequest.expiresAt, now),
					),
				)
				.orderBy(desc(schema.approvalRequest.createdAt))
				.limit(1);
			return approval?.id ?? null;
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

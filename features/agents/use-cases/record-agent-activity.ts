import "@beignet/core/server-only";
import type { AppRuntimePorts } from "@/app-context";
import type {
	AgentActivityResourceType,
	AgentActivityStatus,
} from "@/features/agents/ports";

type AppServer = { ports: AppRuntimePorts };

type ActivityResource = {
	resourceType: AgentActivityResourceType | null;
	resourceId: string | null;
	resourceLabel: string | null;
};

function objectValue(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object"
		? (value as Record<string, unknown>)
		: {};
}

function stringValue(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function activityResource(
	capability: string,
	args: Record<string, unknown> | undefined,
	result: unknown,
): ActivityResource {
	const input = args ?? {};
	const output = objectValue(result);
	const pageCapability = [
		"read_page",
		"create_page",
		"append_to_page",
		"update_page",
		"archive_page",
		"restore_page",
	].includes(capability);
	const taskCapability = [
		"create_task",
		"update_task",
		"complete_task",
		"reopen_task",
		"delete_task",
	].includes(capability);

	if (pageCapability) {
		return {
			resourceType: "page",
			resourceId:
				stringValue(output.pageId) ?? stringValue(input.pageId) ?? null,
			resourceLabel:
				stringValue(output.title) ?? stringValue(input.title) ?? null,
		};
	}
	if (taskCapability) {
		return {
			resourceType: "task",
			resourceId:
				stringValue(output.taskId) ?? stringValue(input.taskId) ?? null,
			resourceLabel:
				stringValue(output.title) ?? stringValue(input.title) ?? null,
		};
	}
	return { resourceType: null, resourceId: null, resourceLabel: null };
}

export async function recordMcpConnectionActivity({
	server,
	connectionId,
	userId,
	capability,
	args,
	result,
	status,
	durationMs,
	errorCode,
}: {
	server: AppServer;
	connectionId: string;
	userId: string;
	capability: string;
	args?: Record<string, unknown>;
	result?: unknown;
	status: AgentActivityStatus;
	durationMs: number;
	errorCode: string | null;
}) {
	const ports = server.ports as AppRuntimePorts;
	const resource = activityResource(capability, args, result);
	try {
		await ports.mcpConnections.recordActivity({
			id: crypto.randomUUID(),
			connectionId,
			userId,
			workspaceId: stringValue(args?.workspaceId),
			capability,
			status,
			...resource,
			durationMs,
			errorCode: errorCode?.slice(0, 100) ?? null,
			createdAt: new Date(),
		});
	} catch (activityError) {
		ports.logger.error("Could not record remote MCP activity", {
			error: activityError,
			connectionId,
			capability,
		});
	}
}

export async function recordAgentActivity({
	server,
	agentId,
	userId,
	capability,
	args,
	result,
	status,
	durationMs,
	error,
}: {
	server: AppServer;
	agentId: string;
	userId: string;
	capability: string;
	args?: Record<string, unknown>;
	result?: unknown;
	status: AgentActivityStatus;
	durationMs: number;
	error: string | null;
}) {
	const ports = server.ports as AppRuntimePorts;
	const resource = activityResource(capability, args, result);
	try {
		await ports.agents.recordActivity({
			id: crypto.randomUUID(),
			agentId,
			userId,
			workspaceId: stringValue(args?.workspaceId),
			capability,
			status,
			...resource,
			durationMs,
			error: error?.slice(0, 500) ?? null,
			createdAt: new Date(),
		});
	} catch (activityError) {
		ports.logger.error("Could not record agent activity", {
			error: activityError,
			agentId,
			capability,
		});
	}
}

import "@beignet/core/server-only";
import { AgentCapabilityError } from "@beignet/core/agent-capabilities";
import { isAppError } from "@beignet/core/errors";
import type { McpServer } from "@modelcontextprotocol/server";
import { APIError } from "better-auth/api";
import type { JWTPayload } from "jose";
import { createMcpHandler } from "mcp-handler";
import type { ZodType } from "zod";
import { capabilitiesForAgentPermissionProfile } from "@/features/agents/permission-profiles";
import type { McpConnectionRow } from "@/features/agents/ports";
import { agentCapabilities } from "@/lib/agent-capability-registry";
import {
	type AgentCapabilityServer,
	executeRemoteMcpCapability,
} from "@/server/agent-capabilities";

export const REMOTE_MCP_SCOPES = ["offline_access", "haunter:mcp"] as const;

export type RemoteMcpIdentity = {
	userId: string;
	clientId: string;
};

export function remoteMcpIdentityFromJwt(
	jwt: JWTPayload,
): RemoteMcpIdentity | null {
	const clientId =
		typeof jwt.client_id === "string"
			? jwt.client_id
			: typeof jwt.azp === "string"
				? jwt.azp
				: null;
	if (typeof jwt.sub !== "string" || !clientId) return null;
	const scopes =
		typeof jwt.scope === "string"
			? new Set(jwt.scope.split(/\s+/).filter(Boolean))
			: new Set<string>();
	if (!scopes.has("haunter:mcp")) return null;
	return { userId: jwt.sub, clientId };
}

export function allowedRemoteMcpCapabilities(
	connection: Pick<McpConnectionRow, "permissionProfile">,
) {
	return new Set<string>(
		capabilitiesForAgentPermissionProfile(connection.permissionProfile),
	);
}

function resultRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function safeToolErrorMessage(error: unknown) {
	if (isAppError(error) || error instanceof APIError) return error.message;
	if (error instanceof AgentCapabilityError) {
		if (error.code === "invalid_input") {
			return "The tool arguments are invalid.";
		}
		if (error.code === "unknown_capability") {
			return "This tool is not available.";
		}
	}
	return "Haunter could not complete this action.";
}

export function registerRemoteMcpTools(
	server: McpServer,
	input: {
		connection: McpConnectionRow;
		identity: RemoteMcpIdentity;
		getServer: () => Promise<AgentCapabilityServer>;
	},
) {
	const allowed = allowedRemoteMcpCapabilities(input.connection);
	for (const capability of agentCapabilities) {
		if (!allowed.has(capability.name)) continue;
		server.registerTool(
			capability.name,
			{
				description: capability.description,
				inputSchema: capability.input as ZodType,
				outputSchema: capability.output as ZodType,
				annotations: {
					readOnlyHint: [
						"list_workspaces",
						"list_workspace_members",
						"list_pages",
						"search_pages",
						"read_page",
						"list_tasks",
					].includes(capability.name),
					destructiveHint: capability.name === "delete_task",
					idempotentHint: [
						"list_workspaces",
						"list_workspace_members",
						"list_pages",
						"search_pages",
						"read_page",
						"list_tasks",
					].includes(capability.name),
				},
			},
			async (args: unknown) => {
				try {
					const argumentsRecord = resultRecord(args) ?? {};
					const result = await executeRemoteMcpCapability(
						{
							capability: capability.name,
							arguments: argumentsRecord,
							userId: input.identity.userId,
							clientId: input.identity.clientId,
						},
						{ getServer: input.getServer },
					);
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(result, null, 2),
							},
						],
						...(resultRecord(result)
							? { structuredContent: resultRecord(result) }
							: {}),
					};
				} catch (error) {
					return {
						isError: true,
						content: [
							{
								type: "text",
								text: safeToolErrorMessage(error),
							},
						],
					};
				}
			},
		);
	}
}

export function createRemoteMcpRequestHandler(input: {
	connection: McpConnectionRow;
	identity: RemoteMcpIdentity;
	getServer: () => Promise<AgentCapabilityServer>;
}) {
	return createMcpHandler((server) => registerRemoteMcpTools(server, input), {
		serverInfo: {
			name: "haunter",
			version: "1.0.0",
		},
		verboseLogs: false,
	});
}

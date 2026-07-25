import "@beignet/core/server-only";
import {
	AgentCapabilityError,
	createAgentCapabilityExecutor,
} from "@beignet/core/agent-capabilities";
import { APIError } from "better-auth/api";
import type { AppContext, AppRuntimePorts } from "@/app-context";
import { capabilitiesForAgentPermissionProfile } from "@/features/agents/permission-profiles";
import {
	recordAgentActivity,
	recordMcpConnectionActivity,
} from "@/features/agents/use-cases/record-agent-activity";
import type { TaskAgentCapabilityDependencies } from "@/features/tasks/agent-capabilities";
import type { AgentPrincipal } from "@/lib/agent-capabilities";
import {
	agentCapabilityRegistry,
	createHaunterAgentCapabilityRegistry,
} from "@/lib/agent-capability-registry";
import type { AppServiceContextInput } from "@/server/context";

export type AgentCapabilityServer = {
	ports: AppRuntimePorts;
	createServiceContext(input?: AppServiceContextInput): Promise<AppContext>;
};

type AgentCapabilityDependencies = TaskAgentCapabilityDependencies & {
	getServer: () => Promise<AgentCapabilityServer>;
};

function inputRecord(input: unknown): Record<string, unknown> | undefined {
	return input !== null && typeof input === "object"
		? (input as Record<string, unknown>)
		: undefined;
}

function executionError(error: unknown): unknown {
	return error instanceof AgentCapabilityError && error.cause
		? error.cause
		: error;
}

export async function createHaunterAgentCapabilityExecutor(
	dependencies: AgentCapabilityDependencies,
) {
	const registry =
		dependencies.getTimezone || dependencies.now
			? createHaunterAgentCapabilityRegistry(dependencies)
			: agentCapabilityRegistry;
	const server = await dependencies.getServer();

	const executor = createAgentCapabilityExecutor({
		registry,
		instrumentation: server.ports,
		hooks: [
			async (event) => {
				if (event.phase === "start") return;
				const error =
					event.phase === "error" ? executionError(event.error) : null;
				if (
					event.principal.transport === "remote-mcp" &&
					event.principal.remoteConnectionId
				) {
					await recordMcpConnectionActivity({
						server,
						connectionId: event.principal.remoteConnectionId,
						userId: event.principal.userId,
						capability: event.name,
						args: inputRecord(event.input),
						...(event.phase === "end" ? { result: event.output } : {}),
						status: event.phase === "end" ? "success" : "error",
						durationMs: event.durationMs,
						errorCode:
							error instanceof AgentCapabilityError
								? error.code
								: error
									? "execution_failed"
									: null,
					});
					return;
				}
				await recordAgentActivity({
					server,
					agentId: event.principal.agentId,
					userId: event.principal.userId,
					capability: event.name,
					args: inputRecord(event.input),
					...(event.phase === "end" ? { result: event.output } : {}),
					status: event.phase === "end" ? "success" : "error",
					durationMs: event.durationMs,
					error:
						error instanceof Error
							? error.message
							: error
								? String(error)
								: null,
				});
			},
		],
		async createContext({ principal, input }) {
			const workspaceId = inputRecord(input)?.workspaceId;
			if (typeof workspaceId !== "string") {
				return server.createServiceContext({
					asUser: { id: principal.userId, role: "member" },
				});
			}

			const ports = server.ports as AppRuntimePorts;
			const role = await ports.members.findRole(workspaceId, principal.userId);
			if (!role) {
				throw new APIError("FORBIDDEN", {
					message: "The acting user is not a member of this workspace.",
				});
			}
			return server.createServiceContext({
				asUser: { id: principal.userId, role },
				tenantId: workspaceId,
			});
		},
	});

	return executor;
}

export async function getRemoteMcpConnection(
	input: { userId: string; clientId: string },
	dependencies: Pick<AgentCapabilityDependencies, "getServer">,
) {
	const server = await dependencies.getServer();
	return server.ports.mcpConnections.findActive(input.userId, input.clientId);
}

export async function executeRemoteMcpCapability(
	input: {
		capability: string;
		arguments?: Record<string, unknown>;
		userId: string;
		clientId: string;
	},
	dependencies: AgentCapabilityDependencies,
): Promise<unknown> {
	const server = await dependencies.getServer();
	const connection = await server.ports.mcpConnections.findActive(
		input.userId,
		input.clientId,
	);
	if (!connection) {
		throw new APIError("FORBIDDEN", {
			message: "This MCP connection is not active.",
		});
	}
	const allowedCapabilities = new Set<string>(
		capabilitiesForAgentPermissionProfile(connection.permissionProfile),
	);
	const authorizedWorkspaceIds = new Set(connection.workspaceIds);

	try {
		return await (
			await createHaunterAgentCapabilityExecutor(dependencies)
		).executeDynamic({
			name: input.capability,
			principal: {
				agentId: `mcp:${connection.id}`,
				userId: input.userId,
				transport: "remote-mcp",
				remoteConnectionId: connection.id,
				remoteClientId: input.clientId,
				authorizedWorkspaceIds: connection.workspaceIds,
			},
			input: input.arguments ?? {},
			authorize({ name, input: parsedInput }) {
				if (!allowedCapabilities.has(name)) {
					throw new APIError("FORBIDDEN", {
						message: "This MCP connection does not allow that action.",
					});
				}
				const workspaceId = inputRecord(parsedInput)?.workspaceId;
				if (
					typeof workspaceId === "string" &&
					!authorizedWorkspaceIds.has(workspaceId)
				) {
					throw new APIError("FORBIDDEN", {
						message: "This MCP connection cannot access that workspace.",
					});
				}
			},
		});
	} catch (error) {
		throw executionError(error);
	}
}

export async function executeAgentCapability(
	input: {
		capability: string;
		arguments?: Record<string, unknown>;
		agentSession: { agentId: string; userId: string | null };
	},
	dependencies: AgentCapabilityDependencies,
): Promise<unknown> {
	if (!input.agentSession.userId) {
		throw new APIError("FORBIDDEN", {
			message: "This capability requires a delegated agent acting for a user.",
		});
	}

	try {
		return await (
			await createHaunterAgentCapabilityExecutor(dependencies)
		).executeDynamic({
			name: input.capability,
			principal: {
				agentId: input.agentSession.agentId,
				userId: input.agentSession.userId,
			},
			input: input.arguments ?? {},
		});
	} catch (error) {
		throw executionError(error);
	}
}

import "@beignet/core/server-only";
import {
	AgentCapabilityError,
	createAgentCapabilityExecutor,
} from "@beignet/core/agent-capabilities";
import { APIError } from "better-auth/api";
import type { AppContext, AppRuntimePorts } from "@/app-context";
import { capabilitiesForAgentPermissionProfile } from "@/features/agents/permission-profiles";
import type { AgentPagePresence } from "@/features/agents/ports";
import {
	ACTIVE_AGENT_PRESENCE_TTL_SECONDS,
	FINISHED_AGENT_PRESENCE_TTL_SECONDS,
	pagePresenceTarget,
} from "@/features/agents/presence";
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
import { requireActiveWorkspaceScope } from "@/lib/auth";
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

function cleanAgentName(value: string | null | undefined): string | null {
	const name = value?.trim();
	return name ? name.slice(0, 80) : null;
}

async function agentDisplayName(
	server: AgentCapabilityServer,
	principal: AgentPrincipal,
): Promise<string> {
	const supplied = cleanAgentName(principal.displayName);
	if (supplied) return supplied;
	try {
		const agents = await server.ports.agents.listByUser(principal.userId);
		return (
			cleanAgentName(
				agents.find((agent) => agent.id === principal.agentId)?.name,
			) ?? "AI agent"
		);
	} catch (error) {
		server.ports.logger.warn("Could not resolve agent presence name", {
			agentId: principal.agentId,
			error,
		});
		return "AI agent";
	}
}

async function publishAgentPresence(
	server: AgentCapabilityServer,
	presence: AgentPagePresence,
): Promise<void> {
	try {
		await server.ports.agentPresence.setPagePresence(presence);
	} catch (error) {
		// Presence is useful context, never part of the capability's correctness.
		server.ports.logger.warn("Could not publish agent page presence", {
			capability: presence.capability,
			pageId: presence.pageId,
			error,
		});
	}
}

async function authorizePagePresence(
	ctx: AppContext,
	capability: string,
	pageId: string,
): Promise<boolean> {
	const scope = requireActiveWorkspaceScope(ctx);
	const page = await ctx.ports.pages.findMetaById(scope, pageId);
	if (!page) return false;
	if (page.deletedAt !== null && capability !== "restore_page") return false;

	if (capability === "read_page") {
		await ctx.gate.authorize("pages.read", page);
	} else if (capability === "archive_page") {
		await ctx.gate.authorize("pages.delete", page);
	} else if (capability === "create_page") {
		await ctx.gate.authorize("pages.create");
	} else {
		await ctx.gate.authorize("pages.update", page);
	}
	return true;
}

export async function createHaunterAgentCapabilityExecutor(
	dependencies: AgentCapabilityDependencies,
) {
	const registry =
		dependencies.getTimezone || dependencies.now
			? createHaunterAgentCapabilityRegistry(dependencies)
			: agentCapabilityRegistry;
	const server = await dependencies.getServer();
	const activePresence = new Map<
		string,
		Pick<AgentPagePresence, "pageId" | "name">
	>();

	const executor = createAgentCapabilityExecutor({
		registry,
		instrumentation: server.ports,
		hooks: [
			async (event) => {
				if (event.phase === "start") return;
				const active = activePresence.get(event.principal.presenceId);
				activePresence.delete(event.principal.presenceId);
				const createdTarget =
					!active && event.phase === "end" && event.name === "create_page"
						? pagePresenceTarget(event.name, event.input, event.output)
						: null;
				const finishedPageId = active?.pageId ?? createdTarget?.pageId ?? null;
				const finishPresence = finishedPageId
					? publishAgentPresence(server, {
							pageId: finishedPageId,
							presenceId: event.principal.presenceId,
							name:
								active?.name ??
								(await agentDisplayName(server, event.principal)),
							status: "finished",
							capability: event.name,
							ttlSeconds: FINISHED_AGENT_PRESENCE_TTL_SECONDS,
						})
					: Promise.resolve();
				const error =
					event.phase === "error" ? executionError(event.error) : null;
				let recordActivity: Promise<void>;
				if (
					event.principal.transport === "remote-mcp" &&
					event.principal.remoteConnectionId
				) {
					recordActivity = recordMcpConnectionActivity({
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
				} else {
					recordActivity = recordAgentActivity({
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
				}
				await Promise.all([recordActivity, finishPresence]);
			},
		],
		async createContext({ name, principal, input }) {
			const workspaceId = inputRecord(input)?.workspaceId;
			let context: AppContext;
			if (typeof workspaceId !== "string") {
				context = await server.createServiceContext({
					asUser: { id: principal.userId, role: "member" },
				});
			} else {
				const ports = server.ports as AppRuntimePorts;
				const role = await ports.members.findRole(
					workspaceId,
					principal.userId,
				);
				if (!role) {
					throw new APIError("FORBIDDEN", {
						message: "The acting user is not a member of this workspace.",
					});
				}
				context = await server.createServiceContext({
					asUser: { id: principal.userId, role },
					tenantId: workspaceId,
				});
			}

			const target = pagePresenceTarget(name, input);
			if (
				target &&
				(await authorizePagePresence(context, name, target.pageId))
			) {
				const displayName = await agentDisplayName(server, principal);
				activePresence.set(principal.presenceId, {
					pageId: target.pageId,
					name: displayName,
				});
				await publishAgentPresence(server, {
					pageId: target.pageId,
					presenceId: principal.presenceId,
					name: displayName,
					status: target.status,
					capability: name,
					ttlSeconds: ACTIVE_AGENT_PRESENCE_TTL_SECONDS,
				});
			}
			return context;
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
				presenceId: crypto.randomUUID(),
				displayName: connection.clientName ?? undefined,
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
				presenceId: crypto.randomUUID(),
			},
			input: input.arguments ?? {},
		});
	} catch (error) {
		throw executionError(error);
	}
}

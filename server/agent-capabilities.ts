import "@beignet/core/server-only";
import {
	AgentCapabilityError,
	createAgentCapabilityExecutor,
} from "@beignet/core/agent-capabilities";
import { APIError } from "better-auth/api";
import type { AppContext, AppRuntimePorts } from "@/app-context";
import { recordAgentActivity } from "@/features/agents/use-cases/record-agent-activity";
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

	return {
		...executor,
		async executeDynamic(invocation: {
			name: string;
			principal: AgentPrincipal;
			input: unknown;
		}) {
			const startedAt = Date.now();
			try {
				const result = await executor.executeDynamic(invocation);
				await recordAgentActivity({
					server,
					agentId: invocation.principal.agentId,
					userId: invocation.principal.userId,
					capability: invocation.name,
					args: inputRecord(invocation.input),
					result,
					status: "success",
					durationMs: Date.now() - startedAt,
					error: null,
				});
				return result;
			} catch (error) {
				const reported = executionError(error);
				await recordAgentActivity({
					server,
					agentId: invocation.principal.agentId,
					userId: invocation.principal.userId,
					capability: invocation.name,
					args: inputRecord(invocation.input),
					status: "error",
					durationMs: Date.now() - startedAt,
					error:
						reported instanceof Error ? reported.message : String(reported),
				});
				throw error;
			}
		},
	};
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

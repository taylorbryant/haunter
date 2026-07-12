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
		hooks: [
			async (event) => {
				if (event.phase === "start") return;
				const error =
					event.phase === "error" ? executionError(event.error) : null;
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

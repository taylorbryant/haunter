import { createTenantScope } from "@beignet/core/ports";
import { createTestDocumentReader } from "@/features/documents/tests/read-repository";
import {
	createTestContextFactory,
	createTestPorts,
	createTestTenant,
	createTestUserActor,
} from "@beignet/core/testing";
import type { AppContext } from "@/app-context";
import type { PageAgentActivity } from "@/features/agents/page-activity";
import { createTestMcpConnectionRepository } from "@/features/agents/tests/helpers";
import type { WorkspaceEvent } from "@/features/collab/workspace-events";
import {
	createTestPageRepository,
	createTestWorkspaceEventPublisher,
} from "@/features/pages/tests/helpers";
import { appPorts } from "@/infra/port-wiring";
import type { AppTransactionPorts } from "@/ports";
import { ACCESS_STATUS_APPROVED } from "@/ports/auth";
import { executeRemoteMcpCapability } from "@/server/agent-capabilities";
import type { AppServiceContextInput } from "@/server/context";

export function activity(
	overrides: Partial<PageAgentActivity> = {},
): PageAgentActivity {
	return {
		schemaVersion: 1,
		type: "agent.pageActivity",
		workspaceId: "workspace",
		pageId: "00000000-0000-4000-8000-000000000001",
		operationId: "00000000-0000-4000-8000-000000000002",
		agentId: "connection",
		agentName: "Codex",
		userId: "user",
		userName: "Taylor",
		action: "append",
		phase: "active",
		startedAt: "2026-09-16T12:00:00.000Z",
		occurredAt: "2026-09-16T12:00:00.000Z",
		...overrides,
	};
}

export async function pageActivityFixture(
	options: {
		role?: string;
		profile?: "view" | "edit" | "full";
		configured?: boolean;
	} = {},
) {
	const userId = "user_presence";
	const workspaceId = "workspace_presence";
	const events: WorkspaceEvent[] = [];
	const pages = createTestPageRepository();
	let role: string | null = options.role ?? "owner";
	const fixture = createTestPorts<AppContext["ports"], AppTransactionPorts>({
		base: appPorts,
		overrides: {
			gate: appPorts.gate,
			pages,
			documents: createTestDocumentReader(pages),
			members: {
				async findRole(workspace, user) {
					return workspace === workspaceId && user === userId ? role : null;
				},
				async listForUser() {
					return [];
				},
				async listByWorkspace() {
					return [
						{
							userId,
							name: "Taylor",
							email: "taylor@example.com",
							role: role ?? "viewer",
						},
					];
				},
			},
			mcpConnections: createTestMcpConnectionRepository([
				{
					id: "connection",
					userId,
					clientId: "client",
					clientName: "Codex",
					permissionProfile: options.profile ?? "edit",
					status: "active",
					workspaceIds: [workspaceId],
					lastUsedAt: null,
					createdAt: new Date(),
					updatedAt: new Date(),
				},
			]),
			broadcast: createTestWorkspaceEventPublisher(events),
			workspaceEventStreamLeases: {
				isConfigured: () => options.configured ?? true,
				acquire: async () => null,
			},
		},
	});
	const scope = createTenantScope(createTestTenant(workspaceId));
	const page = await pages.create(scope, {
		userId,
		parentPageId: null,
		title: "Release plan",
		position: 0,
	});
	const server = {
		ports: fixture.ports,
		async createServiceContext(input?: AppServiceContextInput) {
			return createTestContextFactory<AppContext, AppContext["ports"]>({
				ports: fixture.ports,
				actor: createTestUserActor(userId),
				auth: {
					user: { id: userId, accessStatus: ACCESS_STATUS_APPROVED },
					session: { id: "session", activeOrganizationId: workspaceId },
				},
				tenant: createTestTenant(input?.tenantId ?? workspaceId),
				extra: { membership: { role: input?.asUser?.role ?? "viewer" } },
			})();
		},
	};
	return {
		server,
		userId,
		workspaceId,
		page,
		pages,
		events,
		scope,
		ports: fixture.ports,
		setRole(value: string | null) {
			role = value;
		},
		execute(capability = "read_page", args: Record<string, unknown> = {}) {
			return executeRemoteMcpCapability(
				{
					capability,
					arguments: { workspaceId, pageId: page.id, ...args },
					userId,
					clientId: "client",
				},
				{ getServer: async () => server },
			);
		},
	};
}

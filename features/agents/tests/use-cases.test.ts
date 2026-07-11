import { describe, expect, it } from "bun:test";
import { createUseCaseTester } from "@beignet/core/application";
import { createTestTenant, createTestUserActor } from "@beignet/core/testing";
import {
	createTestContextFactory,
	createTestPorts,
} from "@beignet/core/testing";
import { createInMemoryDevtools } from "@beignet/devtools";
import type { AppContext } from "@/app-context";
import { appPorts } from "@/infra/app-ports";
import type { AppTransactionPorts } from "@/ports";
import { ACCESS_STATUS_APPROVED } from "@/ports/auth";
import type { AgentAdminRow } from "../ports";
import type { AgentActivityWrite } from "../ports";
import {
	getPendingAgentUseCase,
	listAgentActivityUseCase,
	listAgentsUseCase,
} from "../use-cases";
import { createTestAgentAdminRepository } from "./helpers";

function agentRow(overrides: Partial<AgentAdminRow> = {}): AgentAdminRow {
	return {
		id: crypto.randomUUID(),
		name: "Test agent",
		mode: "delegated",
		status: "active",
		hostName: "test-host",
		grants: [{ capability: "read_page", status: "active" }],
		lastUsedAt: null,
		createdAt: new Date("2026-07-01T00:00:00.000Z"),
		userId: "user_test",
		...overrides,
	};
}

function createFixture(
	rows: AgentAdminRow[],
	activities: AgentActivityWrite[] = [],
	currentApprovalIds?: Map<string, string | null>,
) {
	const agents = createTestAgentAdminRepository(
		rows,
		activities,
		currentApprovalIds,
	);
	const workspaceId = crypto.randomUUID().replaceAll("-", "");
	const auth = {
		user: {
			id: "user_test",
			email: "user_test@example.com",
			name: "Test",
			accessStatus: ACCESS_STATUS_APPROVED,
		},
		session: { id: "session_test", activeOrganizationId: workspaceId },
	};
	const fixture = createTestPorts<AppContext["ports"], AppTransactionPorts>({
		base: appPorts,
		overrides: {
			gate: appPorts.gate,
			agents,
			devtools: createInMemoryDevtools(),
		},
		transaction: {
			ports: (ports) => ({ ...ports, agents }),
		},
	});
	const createTestContext = createTestContextFactory<
		AppContext,
		AppContext["ports"]
	>({
		ports: fixture.ports,
		actor: createTestUserActor(auth.user.id, { displayName: "Test" }),
		auth,
		tenant: createTestTenant(workspaceId),
		extra: { membership: { role: "owner" } },
	});
	return createUseCaseTester<AppContext>(createTestContext);
}

describe("agents.list", () => {
	it("returns only the caller's agents", async () => {
		const mine = agentRow({ name: "Mine" });
		const theirs = agentRow({ name: "Theirs", userId: "user_other" });
		const tester = createFixture([mine, theirs]);

		const result = await tester.run(listAgentsUseCase, {});

		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toMatchObject({
			name: "Mine",
			hostName: "test-host",
			grants: [{ capability: "read_page", status: "active" }],
		});
		expect(result.items[0].createdAt).toBe("2026-07-01T00:00:00.000Z");
	});

	it("excludes unclaimed pending agents (no userId yet)", async () => {
		const pending = agentRow({ status: "pending", userId: null });
		const tester = createFixture([pending]);

		const result = await tester.run(listAgentsUseCase, {});

		expect(result.items).toHaveLength(0);
	});
});

describe("agents.getPending", () => {
	it("returns pending capability requests with catalog descriptions", async () => {
		const pending = agentRow({
			status: "pending",
			userId: null,
			grants: [
				{ capability: "read_page", status: "pending" },
				{ capability: "search_pages", status: "pending" },
				// Already-active grants are not part of the approval ask.
				{ capability: "list_workspaces", status: "active" },
			],
		});
		const tester = createFixture([pending]);

		const result = await tester.run(getPendingAgentUseCase, {
			agentId: pending.id,
		});

		expect(result.requestedCapabilities.map((c) => c.name)).toEqual([
			"read_page",
			"search_pages",
		]);
		expect(result.requestedCapabilities[0].description.length).toBeGreaterThan(
			0,
		);
		expect(result.approvalId).toBe(`approval_${pending.id}`);
	});

	it("returns additional capability requests for an owned active agent", async () => {
		const active = agentRow({
			grants: [
				{ capability: "read_page", status: "active" },
				{ capability: "list_tasks", status: "pending" },
			],
		});
		const tester = createFixture([active]);

		const result = await tester.run(getPendingAgentUseCase, {
			agentId: active.id,
		});

		expect(result.requestedCapabilities.map((c) => c.name)).toEqual([
			"list_tasks",
		]);
	});

	it("404s when an agent has no pending capability requests", async () => {
		const active = agentRow();
		const tester = createFixture([active]);

		await expect(
			tester.run(getPendingAgentUseCase, { agentId: active.id }),
		).rejects.toMatchObject({ code: "AGENT_NOT_FOUND" });
	});

	it("does not expose another user's active agent request", async () => {
		const active = agentRow({
			userId: "user_other",
			grants: [{ capability: "list_tasks", status: "pending" }],
		});
		const tester = createFixture([active]);

		await expect(
			tester.run(getPendingAgentUseCase, { agentId: active.id }),
		).rejects.toMatchObject({ code: "AGENT_NOT_FOUND" });
	});

	it("404s when no unexpired device approval remains", async () => {
		const active = agentRow({
			grants: [{ capability: "list_tasks", status: "pending" }],
		});
		const tester = createFixture([active], [], new Map([[active.id, null]]));

		await expect(
			tester.run(getPendingAgentUseCase, { agentId: active.id }),
		).rejects.toMatchObject({ code: "AGENT_NOT_FOUND" });
	});
});

describe("agents.listActivity", () => {
	it("returns only the caller's recent activity", async () => {
		const mine = agentRow({ name: "Mine" });
		const theirs = agentRow({ name: "Theirs", userId: "user_other" });
		const baseActivity = {
			workspaceId: "workspace_test",
			capability: "create_task",
			status: "success" as const,
			resourceType: "task" as const,
			resourceId: crypto.randomUUID(),
			resourceLabel: "Prepare notes",
			durationMs: 12,
			error: null,
		};
		const tester = createFixture(
			[mine, theirs],
			[
				{
					...baseActivity,
					id: crypto.randomUUID(),
					agentId: mine.id,
					userId: "user_test",
					createdAt: new Date("2026-07-10T12:00:00.000Z"),
				},
				{
					...baseActivity,
					id: crypto.randomUUID(),
					agentId: theirs.id,
					userId: "user_other",
					createdAt: new Date("2026-07-10T13:00:00.000Z"),
				},
			],
		);

		const result = await tester.run(listAgentActivityUseCase, { limit: 25 });

		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toMatchObject({
			agentId: mine.id,
			agentName: "Mine",
			capability: "create_task",
			resourceLabel: "Prepare notes",
		});
	});
});

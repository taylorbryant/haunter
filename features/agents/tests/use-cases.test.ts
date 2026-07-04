import { describe, expect, it } from "bun:test";
import { createUseCaseTester } from "@beignet/core/application";
import {
	createTestTenant,
	createTestUserActor,
} from "@beignet/core/ports/testing";
import {
	createTestContextFactory,
	createTestPorts,
} from "@beignet/core/testing";
import { createInMemoryDevtools } from "@beignet/devtools";
import type { AppContext } from "@/app-context";
import { appPorts } from "@/infra/app-ports";
import type { AppTransactionPorts } from "@/ports";
import type { AgentAdminRow } from "../ports";
import { getPendingAgentUseCase, listAgentsUseCase } from "../use-cases";
import { createTestAgentAdminRepository } from "./helpers";

function agentRow(
	overrides: Partial<AgentAdminRow & { userId: string | null }> = {},
): AgentAdminRow & { userId: string | null } {
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

function createFixture(rows: (AgentAdminRow & { userId: string | null })[]) {
	const agents = createTestAgentAdminRepository(rows);
	const workspaceId = crypto.randomUUID().replaceAll("-", "");
	const auth = {
		user: { id: "user_test", email: "user_test@example.com", name: "Test" },
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
	});

	it("404s for agents that are not pending", async () => {
		const active = agentRow();
		const tester = createFixture([active]);

		await expect(
			tester.run(getPendingAgentUseCase, { agentId: active.id }),
		).rejects.toMatchObject({ code: "AGENT_NOT_FOUND" });
	});
});

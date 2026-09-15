import { describe, expect, it } from "bun:test";
import {
	BroadcastClientError,
	createBroadcastClient,
} from "@beignet/core/broadcasting/client";
import { createStaticAuth } from "@beignet/core/ports";
import { defineRoutes } from "@beignet/core/server";
import { createTestPorts } from "@beignet/core/testing";
import { createInMemoryDevtools } from "@beignet/devtools";
import { createBroadcastRoute } from "@beignet/next";
import { createTestApp } from "@beignet/web/testing";
import type { AppContext } from "@/app-context";
import { appPorts } from "@/infra/port-wiring";
import { routeAuth } from "@/lib/route-auth";
import type { AppTransactionPorts } from "@/ports";
import {
	ACCESS_STATUS_APPROVED,
	type AuthRequest,
	type AuthSessionMetadata,
	type AuthUser,
} from "@/ports/auth";
import {
	admitWorkspaceBroadcast,
	WORKSPACE_BROADCAST_LEASE_TTL_MS,
	WORKSPACE_BROADCAST_LIFETIME_MS,
} from "@/server/broadcast-admission";
import { channels } from "@/server/broadcasts";
import { type AppServiceContextInput, appContext } from "@/server/context";
import { workspaceChanges } from "../channels";
import { createWorkspaceTaskEvent } from "../workspace-events";
import { deferred, memoryBroadcast, until } from "./helpers";

async function fixture(
	options: {
		anonymous?: boolean;
		full?: boolean;
		configured?: boolean;
		lifetime?: number;
	} = {},
) {
	const bus = memoryBroadcast();
	let member = true;
	let acquired = 0;
	let released = 0;
	const ports = createTestPorts<AppContext["ports"], AppTransactionPorts>({
		base: appPorts,
		overrides: {
			gate: appPorts.gate,
			devtools: createInMemoryDevtools(),
			broadcast: bus.port,
			auth: createStaticAuth<AuthUser, AuthSessionMetadata, AuthRequest>(
				options.anonymous
					? null
					: {
							user: {
								id: "user_1",
								email: "one@example.com",
								accessStatus: ACCESS_STATUS_APPROVED,
							},
							session: { id: "session_1", activeOrganizationId: "workspace_1" },
						},
			),
			members: {
				async findRole() {
					return member ? "owner" : null;
				},
				async listForUser() {
					return [];
				},
				async listByWorkspace() {
					return [];
				},
			},
			workspaceEventStreamLeases: {
				isConfigured: () => options.configured !== false,
				async acquire(input) {
					expect(input.userId).toBe("user_1");
					expect(input.ttlMs).toBe(WORKSPACE_BROADCAST_LEASE_TTL_MS);
					acquired++;
					return options.full
						? null
						: {
								async release() {
									released++;
								},
							};
				},
			},
		},
		transaction: { ports: (value) => ({ ...value }) },
	});
	const app = await createTestApp<
		AppContext,
		AppContext["ports"],
		AppServiceContextInput
	>({
		ports: ports.ports,
		context: appContext,
		routes: defineRoutes<AppContext>([]),
	});
	const route = createBroadcastRoute({
		server: app.server,
		channels,
		hooks: [routeAuth.required()],
		admit: admitWorkspaceBroadcast,
		maxLifetimeMs: options.lifetime ?? WORKSPACE_BROADCAST_LIFETIME_MS,
	});
	function request(workspaceId = "workspace_1") {
		const url = new URL("http://beignet.test/api/broadcasts");
		url.searchParams.set(
			"subscriptions",
			JSON.stringify({
				version: 1,
				channels: [
					{ id: "one", name: workspaceChanges.name, params: { workspaceId } },
				],
			}),
		);
		return new Request(url);
	}
	const client = createBroadcastClient({
		url: "http://beignet.test/api/broadcasts",
		fetch: (input, init) => route.GET(new Request(input, init)),
	});
	return {
		bus,
		route,
		request,
		client,
		revoke: () => {
			member = false;
		},
		acquired: () => acquired,
		released: () => released,
		async close() {
			client.close();
			await app.stop();
		},
	};
}

describe("workspace broadcast route", () => {
	it("streams typed events only for the authorized workspace and cleans up", async () => {
		const f = await fixture();
		try {
			const ready = deferred();
			const received: unknown[] = [];
			const subscription = f.client.subscribe(workspaceChanges, {
				params: { workspaceId: "workspace_1" },
				onSync: () => ready.resolve(),
				onEvent: (event) => {
					received.push(event.data);
				},
			});
			await ready.promise;
			expect(f.bus.subscriberCount()).toBe(1);
			const data = createWorkspaceTaskEvent({
				workspaceId: "workspace_1",
				taskId: "task_1",
			});
			await f.bus.port.publish(workspaceChanges, {
				params: { workspaceId: "workspace_2" },
				event: "changed",
				data: { ...data, workspaceId: "workspace_2" },
			});
			await f.bus.port.publish(workspaceChanges, {
				params: { workspaceId: "workspace_1" },
				event: "changed",
				data,
			});
			await until(() => received.length === 1);
			expect(received).toEqual([data]);
			subscription.unsubscribe();
			await until(() => f.released() === 1 && f.bus.subscriberCount() === 0);
			expect(f.bus.subscriberCount()).toBe(0);
		} finally {
			await f.close();
		}
	});

	it("advertises the four-minute lifetime and releases on cancellation", async () => {
		const f = await fixture();
		try {
			const response = await f.route.GET(f.request());
			expect(response.status).toBe(200);
			if (!response.body) throw new Error("Missing broadcast stream");
			const reader = response.body.getReader();
			let text = "";
			while (!text.includes("240000"))
				text += new TextDecoder().decode((await reader.read()).value);
			expect(text).toContain("240000");
			await reader.cancel();
			await until(() => f.released() === 1);
		} finally {
			await f.close();
		}
	});

	it.each([
		{ anonymous: true, status: 401 },
		{ full: true, status: 429 },
		{ configured: false, status: 503 },
	])("rejects before streaming: %j", async ({ status, ...options }) => {
		const f = await fixture(options);
		try {
			const response = await f.route.GET(f.request());
			expect(response.status).toBe(status);
			if (status === 429)
				expect(response.headers.get("retry-after")).toBe("30");
			expect(f.bus.subscriberCount()).toBe(0);
			expect(f.acquired()).toBe(status === 429 ? 1 : 0);
		} finally {
			await f.close();
		}
	});

	it("blocks cross-workspace access without subscribing", async () => {
		const f = await fixture();
		try {
			const denied = deferred<unknown>();
			f.client.subscribe(workspaceChanges, {
				params: { workspaceId: "workspace_2" },
				onSync() {
					throw new Error("Unauthorized readiness");
				},
				onEvent() {},
				onError: denied.resolve,
			});
			const error = await denied.promise;
			expect(error).toBeInstanceOf(BroadcastClientError);
			expect((error as BroadcastClientError).status).toBe(403);
			await until(() => f.released() === 1);
			expect(f.bus.subscriberCount()).toBe(0);
		} finally {
			await f.close();
		}
	});

	it("renews automatically and rechecks revoked membership", async () => {
		const f = await fixture({ lifetime: 120 });
		try {
			const reasons: string[] = [];
			const denied = deferred<unknown>();
			f.client.subscribe(workspaceChanges, {
				params: { workspaceId: "workspace_1" },
				onEvent() {},
				onError: denied.resolve,
				onSync(info) {
					reasons.push(info.reason);
					if (reasons.length === 2) f.revoke();
				},
			});
			const error = await denied.promise;
			expect(reasons).toEqual(["initial", "planned-renewal"]);
			expect((error as BroadcastClientError).status).toBe(403);
			await until(() => f.released() === f.acquired());
			expect(f.bus.subscriberCount()).toBe(0);
		} finally {
			await f.close();
		}
	});

	it("cleans up an interrupted transport and reconciles after reconnect", async () => {
		const f = await fixture();
		try {
			const reasons: string[] = [];
			f.client.subscribe(workspaceChanges, {
				params: { workspaceId: "workspace_1" },
				onEvent() {},
				onSync(info) {
					reasons.push(info.reason);
				},
			});
			await until(() => reasons.length === 1);
			f.bus.disconnect();
			await until(() => f.released() === 1);
			await until(() => reasons.length === 2);
			// A server-side transport loss closes SSE without a terminal reason.
			expect(reasons).toEqual(["initial", "unknown"]);
		} finally {
			await f.close();
		}
	});
});

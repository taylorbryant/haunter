import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { defineChannel } from "@beignet/core/broadcasting";
import { BroadcastClientError } from "@beignet/core/broadcasting/client";
import { createStaticAuth } from "@beignet/core/ports";
import { defineRoutes } from "@beignet/core/server";
import { createTestPorts } from "@beignet/core/testing";
import { createInMemoryDevtools } from "@beignet/devtools";
import { createBroadcastRoute } from "@beignet/next";
import { createTestApp } from "@beignet/web/testing";
import { QueryClient } from "@tanstack/react-query";
import type { AppContext } from "@/app-context";
import { createAppBroadcastClient } from "@/client/broadcasts";
import {
	pageAgentActivityKey,
	type CachedPageAgentActivity,
} from "@/features/agents/client/page-activity-cache";
import { activity } from "@/features/agents/tests/page-activity-fixture";
import { PageAgentActivitySchema } from "@/features/agents/page-activity";
import { canvasActivityFixture } from "@/features/agents/tests/canvas-activity-fixture";
import {
	canvasAgentActivityKey,
	type CachedCanvasAgentActivity,
} from "@/features/agents/client/canvas-activity-cache";
import { listTasksQueryOptions } from "@/features/tasks/client/queries";
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
import { workspaceChanges, workspaceCanvasActivity } from "../channels";
import {
	WorkspacePageEventSchema,
	WorkspaceTaskEventSchema,
	WorkspaceCanvasEventSchema,
} from "../schemas";
import { subscribeToWorkspaceChanges } from "../client/broadcasts";
import { WORKSPACE_EVENT_TIME_HEADER } from "../headers";
import { withWorkspaceEventClock } from "../server/event-clock";
import { createWorkspaceTaskEvent } from "../workspace-events";
import { deferred, memoryBroadcast, until } from "./helpers";

// Preserve the pre-canvas-activity client's union instead of importing the
// current WorkspaceEventSchema, which would hide mixed-version regressions.
const legacyWorkspaceChanges = defineChannel("workspace.changes", {
	params: z.object({ workspaceId: z.string().min(1) }),
	events: {
		changed: z.discriminatedUnion("type", [
			WorkspacePageEventSchema,
			WorkspaceTaskEventSchema,
			WorkspaceCanvasEventSchema,
			PageAgentActivitySchema,
		]),
	},
});

async function fixture(
	options: {
		anonymous?: boolean;
		full?: boolean;
		configured?: boolean;
		lifetime?: number;
		workspaceId?: string;
	} = {},
) {
	const bus = memoryBroadcast();
	const workspaceId = options.workspaceId ?? "workspace_1";
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
							session: { id: "session_1", activeOrganizationId: workspaceId },
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
	const adapter = createBroadcastRoute({
		server: app.server,
		channels,
		hooks: [routeAuth.required()],
		admit: admitWorkspaceBroadcast,
		maxLifetimeMs: options.lifetime ?? WORKSPACE_BROADCAST_LIFETIME_MS,
	});
	const route = {
		async GET(request: Request) {
			return withWorkspaceEventClock(await adapter.GET(request));
		},
	};
	function request(requestedWorkspaceId = workspaceId) {
		const url = new URL("http://beignet.test/api/broadcasts");
		url.searchParams.set(
			"subscriptions",
			JSON.stringify({
				version: 1,
				channels: [
					{
						id: "one",
						name: workspaceChanges.name,
						params: { workspaceId: requestedWorkspaceId },
					},
				],
			}),
		);
		return new Request(url);
	}
	const createClient = () =>
		createAppBroadcastClient((input, init) =>
			route.GET(
				new Request(new URL(String(input), "http://beignet.test"), init),
			),
		);
	const client = createClient();
	return {
		bus,
		route,
		request,
		client,
		createClient,
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
	it("keeps legacy tabs connected while new tabs receive MCP canvas activity on the same stream", async () => {
		const commands = await canvasActivityFixture();
		const workspaceId = commands.workspaceId;
		const f = await fixture({ workspaceId });
		commands.ports.broadcast = f.bus.port;
		const work = deferred();
		const execute = commands.ports.canvasEditing.execute;
		commands.ports.canvasEditing.execute = async (input) => {
			await work.promise;
			return execute(input);
		};
		const queryClient = new QueryClient();
		const updatedClient = f.createClient();
		const errors: unknown[] = [];
		const legacyEvents: unknown[] = [];
		const taskKey = listTasksQueryOptions(workspaceId, "open").queryKey;
		const activityKey = canvasAgentActivityKey("user_1", workspaceId);
		let legacyReady = 0;
		const legacySubscription = f.client.subscribe(legacyWorkspaceChanges, {
			params: { workspaceId },
			onSync() {
				legacyReady++;
			},
			onEvent({ data }) {
				legacyEvents.push(data);
			},
			onError(error) {
				errors.push(error);
			},
		});
		const unsubscribe = subscribeToWorkspaceChanges({
			client: updatedClient,
			queryClient,
			userId: "user_1",
			workspaceId,
			getClock: updatedClient.getClock,
			getCurrentPageId: () => undefined,
			onPageRemoved() {},
			onError(error) {
				errors.push(error);
			},
		});
		let running: Promise<unknown> | undefined;
		try {
			await until(() => legacyReady === 1 && f.bus.subscriberCount() === 3);
			// Two browser connections, despite the new client subscribing to two
			// channels. Activity must not consume an additional connection lease.
			expect(f.acquired()).toBe(2);
			queryClient.setQueryData(taskKey, { items: [] });
			const before = createWorkspaceTaskEvent({
				workspaceId,
				taskId: "before",
			});
			await f.bus.port.publish(workspaceChanges, {
				params: { workspaceId },
				event: "changed",
				data: before,
			});
			await until(
				() =>
					legacyEvents.length === 1 &&
					queryClient.getQueryState(taskKey)?.isInvalidated === true,
			);
			queryClient.setQueryData(taskKey, { items: [] });
			running = commands.execute();
			await until(
				() =>
					queryClient.getQueryData<CachedCanvasAgentActivity[]>(
						activityKey,
					)?.[0]?.phase === "active",
			);
			work.resolve();
			await running;
			await until(
				() =>
					queryClient.getQueryData<CachedCanvasAgentActivity[]>(
						activityKey,
					)?.[0]?.phase === "completed",
			);
			expect(
				queryClient.getQueryData<CachedCanvasAgentActivity[]>(activityKey),
			).toMatchObject([
				{ canvasId: commands.canvas.id, changedShapeIds: ["shape:old"] },
			]);
			commands.ports.canvasEditing.execute = async () => {
				throw new Error("Worker unavailable");
			};
			await expect(commands.execute()).rejects.toThrow();
			await until(
				() =>
					queryClient
						.getQueryData<CachedCanvasAgentActivity[]>(activityKey)
						?.at(-1)?.phase === "failed",
			);
			expect(queryClient.getQueryState(taskKey)?.isInvalidated).toBe(false);
			const after = createWorkspaceTaskEvent({ workspaceId, taskId: "after" });
			await f.bus.port.publish(workspaceChanges, {
				params: { workspaceId },
				event: "changed",
				data: after,
			});
			await until(
				() =>
					legacyEvents.length === 2 &&
					queryClient.getQueryState(taskKey)?.isInvalidated === true,
			);
			expect(legacyEvents).toEqual([before, after]);
			expect(errors).toEqual([]);
			expect(f.client.getStatus()).toBe("connected");
			expect(updatedClient.getStatus()).toBe("connected");
			expect(f.acquired()).toBe(2);
		} finally {
			work.resolve();
			await running?.catch(() => {});
			legacySubscription.unsubscribe();
			unsubscribe();
			updatedClient.close();
			queryClient.clear();
			await f.close();
		}
		await until(
			() => f.released() === f.acquired() && f.bus.subscriberCount() === 0,
		);
	});

	it("delivers agent activity through the real stream and clears it on interruption", async () => {
		const f = await fixture();
		const queryClient = new QueryClient();
		const key = pageAgentActivityKey("user_1", "workspace_1");
		let synced = 0;
		const unsubscribe = subscribeToWorkspaceChanges({
			client: f.client,
			queryClient,
			userId: "user_1",
			workspaceId: "workspace_1",
			getClock: f.client.getClock,
			getCurrentPageId: () => undefined,
			onPageRemoved() {},
			onSync() {
				synced++;
			},
		});
		try {
			await until(() => synced === 1);
			expect(f.client.getClock()?.serverTime).toBeGreaterThan(0);
			const now = new Date().toISOString();
			const event = activity({
				workspaceId: "workspace_1",
				startedAt: now,
				occurredAt: now,
			});
			for (const phase of ["active", "completed"] as const) {
				await f.bus.port.publish(workspaceChanges, {
					params: { workspaceId: "workspace_1" },
					event: "changed",
					data: { ...event, phase },
				});
				await until(
					() =>
						queryClient.getQueryData<CachedPageAgentActivity[]>(key)?.[0]
							?.phase === phase,
				);
			}
			f.bus.disconnect();
			await until(
				() =>
					queryClient.getQueryData<CachedPageAgentActivity[]>(key)?.length ===
					0,
			);
			await until(() => synced === 2);
			expect(f.client.getClock()?.serverTime).toBeGreaterThan(0);
			expect(queryClient.getQueryData<CachedPageAgentActivity[]>(key)).toEqual(
				[],
			);
		} finally {
			unsubscribe();
			queryClient.clear();
			await f.close();
		}
		expect(f.client.getClock()).toBeNull();
	});

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
			expect(
				Number(response.headers.get(WORKSPACE_EVENT_TIME_HEADER)),
			).toBeGreaterThan(0);
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
			expect(response.headers.has(WORKSPACE_EVENT_TIME_HEADER)).toBe(false);
			if (status === 429)
				expect(response.headers.get("retry-after")).toBe("30");
			expect(f.bus.subscriberCount()).toBe(0);
			expect(f.acquired()).toBe(status === 429 ? 1 : 0);
		} finally {
			await f.close();
		}
	});

	it.each([workspaceChanges, workspaceCanvasActivity])(
		"blocks cross-workspace access to $name without subscribing",
		async (channel) => {
			const f = await fixture();
			try {
				const denied = deferred<unknown>();
				f.client.subscribe(channel, {
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
		},
	);

	it.each([workspaceChanges, workspaceCanvasActivity])(
		"renews $name automatically and rechecks revoked membership",
		async (channel) => {
			const f = await fixture({ lifetime: 120 });
			try {
				const reasons: string[] = [];
				const denied = deferred<unknown>();
				f.client.subscribe(channel, {
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
		},
	);

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

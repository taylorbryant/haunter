import { afterAll, beforeAll, expect, mock, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { createIdempotencyHooks, defineRoutes } from "@beignet/core/server";
import { createRecordingBestEffortWork } from "@beignet/core/testing";
import { createBroadcastRoute } from "@beignet/next";
import { createTestApp } from "@beignet/web/testing";
import {
	QueryClient,
	QueryClientProvider,
	useQuery,
} from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import type { AppContext } from "@/app-context";
import { createAppBroadcastClient } from "@/client/broadcasts";
import { installSessionCredential } from "@/client/session-recovery";
import { AppSessionProvider } from "@/components/app-session-provider";
import {
	workspaceChanges,
	workspaceFavorites,
} from "@/features/collab/channels";
import { withWorkspaceEventClock } from "@/features/collab/server/event-clock";
import {
	deferred,
	memoryBroadcast,
	until,
} from "@/features/collab/tests/helpers";
import { createWorkspacePageEvent } from "@/features/collab/workspace-events";
import { listTasksQueryOptions } from "@/features/tasks/client/queries";
import { taskRoutes } from "@/features/tasks/routes";
import * as schema from "@/infra/db/schema";
import { routeAuth } from "@/lib/route-auth";
import { executeRemoteMcpCapability } from "@/server/agent-capabilities";
import { admitWorkspaceBroadcast } from "@/server/broadcast-admission";
import { channels } from "@/server/broadcasts";
import { appContext, type AppServiceContextInput } from "@/server/context";
import { embeddedEditorAuthHooks } from "@/server/embedded-editor-auth";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import { authorizeEmbeddedWorkspaceUseCase } from "../use-cases/authorize-embedded-workspace";
import { embeddedEditorFixture } from "./embedded-editor-fixture";

// Embedded navigation must take precedence over the unchanged Next route.
mock.module("next/navigation", () => ({
	useParams: () => ({ pageId: "old-next-route-page" }),
	useRouter: () => ({ replace: mock(), push: mock(), prefetch: mock() }),
}));

let Subscriber: ComponentType<
	Parameters<
		typeof import("@/features/collab/client/workspace-events").WorkspaceEventSubscriber
	>[0]
>;
const previousLiveUpdates = process.env.NEXT_PUBLIC_LIVE_UPDATES;
beforeAll(async () => {
	installTestDom();
	process.env.NEXT_PUBLIC_LIVE_UPDATES = "true";
	({ WorkspaceEventSubscriber: Subscriber } = await import(
		"@/features/collab/client/workspace-events"
	));
});
afterAll(async () => {
	if (previousLiveUpdates === undefined)
		delete process.env.NEXT_PUBLIC_LIVE_UPDATES;
	else process.env.NEXT_PUBLIC_LIVE_UPDATES = previousLiveUpdates;
	await uninstallTestDom();
});

async function fixture(access: "view" | "edit" = "edit") {
	const f = await embeddedEditorFixture(access);
	const bus = memoryBroadcast();
	const work = createRecordingBestEffortWork();
	let acquired = 0;
	let released = 0;
	f.ctx.ports.broadcast = bus.port;
	f.ctx.ports.bestEffortWork = work.bestEffortWork;
	f.ctx.ports.workspaceEventStreamLeases = {
		isConfigured: () => true,
		async acquire() {
			acquired++;
			return {
				async release() {
					released++;
				},
			};
		},
	};
	const app = await createTestApp<
		AppContext,
		AppContext["ports"],
		AppServiceContextInput
	>({
		ports: f.ctx.ports,
		context: appContext,
		hooks: [embeddedEditorAuthHooks, createIdempotencyHooks<AppContext>()],
		routes: defineRoutes<AppContext>([taskRoutes]),
	});
	const route = createBroadcastRoute({
		server: app.server,
		channels,
		hooks: [routeAuth.required()],
		admit: admitWorkspaceBroadcast,
	});
	const proofSecret = createHash("sha256")
		.update(crypto.randomUUID())
		.digest("base64url");
	const handoff = await authorizeEmbeddedWorkspaceUseCase.run({
		ctx: f.ctx,
		input: {
			workspaceId: f.workspaceId,
			clientId: "embedded-client",
			challenge: createHash("sha256").update(proofSecret).digest("base64url"),
		},
	});
	const session = await f.ctx.ports.embeddedEditorSessions.exchange({
		...handoff,
		proofSecret,
	});
	if (!session) throw new Error("Missing session");
	const fetchRequest = async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = new Request(
			new URL(String(input), window.location.origin),
			init,
		);
		return new URL(request.url).pathname === "/api/broadcasts"
			? withWorkspaceEventClock(await route.GET(request))
			: app.fetch(request);
	};
	return {
		...f,
		bus,
		work,
		session,
		fetchRequest,
		acquired: () => acquired,
		released: () => released,
		createClient(token = session.token) {
			return createAppBroadcastClient((input, init) =>
				fetchRequest(input, {
					...init,
					headers: { authorization: `HaunterEmbed ${token}` },
				}),
			);
		},
		execute(capability: string, args: Record<string, unknown>) {
			return executeRemoteMcpCapability(
				{
					capability,
					arguments: { workspaceId: f.workspaceId, ...args },
					userId: f.userId,
					clientId: "embedded-client",
				},
				{ getServer: async () => app.server },
			);
		},
		async close() {
			await app.stop();
			await f.database.close();
		},
	};
}

test("MCP task writes refresh a mounted embedded task list without polling; navigation keeps one stream", async () => {
	const f = await fixture();
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: Infinity } },
	});
	const uninstallCredential = installSessionCredential(
		async () => f.session.token,
	);
	const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				expect(new Headers(init?.headers).get("authorization")).toBe(
					`HaunterEmbed ${f.session.token}`,
				);
				expect(init?.credentials).toBe("omit");
				return f.fetchRequest(input, init);
			},
			{ preconnect: fetch.preconnect },
		),
	);
	const removed: string[] = [];
	const value = {
		user: {
			id: f.userId,
			name: "Document User",
			email: "document@example.com",
			image: null,
		},
		activeWorkspaceId: f.workspaceId,
		workspaceRole: "owner",
		isAdmin: false,
	};
	function Tasks() {
		const tasks = useQuery({
			...listTasksQueryOptions(f.workspaceId, "open"),
			refetchInterval: false,
		});
		return (
			<output aria-label="Tasks">
				{tasks.data?.items.map((task) => task.title).join(", ") ?? "Loading"}
			</output>
		);
	}
	const panel = (pageId?: string) => (
		<QueryClientProvider client={client}>
			<AppSessionProvider
				value={value}
				embedded
				verifySession={async () => ({
					userId: f.userId,
					workspaceId: f.workspaceId,
					role: "owner",
				})}
			>
				<Subscriber
					workspaceId={f.workspaceId}
					navigation={{ pageId, onPageRemoved: (id) => removed.push(id) }}
				/>
				<Tasks />
			</AppSessionProvider>
		</QueryClientProvider>
	);
	try {
		const view = render(panel());
		await waitFor(() =>
			expect(view.getByRole("status", { name: "Tasks" }).textContent).toBe(""),
		);
		await until(() => f.bus.subscriberCount() === 3);
		let taskId = "";
		await act(async () => {
			const created = (await f.execute("create_task", {
				title: "Added by the agent",
			})) as { taskId: string };
			taskId = created.taskId;
			await f.work.flush();
		});
		await waitFor(() =>
			expect(view.getByText("Added by the agent")).toBeDefined(),
		);
		await act(async () => {
			await f.execute("complete_task", { taskId });
			await f.work.flush();
		});
		await waitFor(() =>
			expect(view.getByRole("status", { name: "Tasks" }).textContent).toBe(""),
		);
		// Switch the embedded route without changing Next params or opening another stream.
		view.rerender(panel(f.page.id));
		expect(f.acquired()).toBe(1);
		await act(async () => {
			await f.bus.port.publish(workspaceChanges, {
				params: { workspaceId: f.workspaceId },
				event: "changed",
				data: createWorkspacePageEvent({
					type: "page.trashed",
					workspaceId: f.workspaceId,
					pageId: f.page.id,
				}),
			});
		});
		await waitFor(() => expect(removed).toEqual([f.page.id]));
		view.unmount();
		await until(() => f.released() === 1 && f.bus.subscriberCount() === 0);
	} finally {
		cleanup();
		client.clear();
		uninstallCredential();
		fetchSpy.mockRestore();
		await f.close();
	}
});

test.each(["view", "edit"] as const)(
	"%s workspace grants can receive events, while document, foreign-workspace, and other-user grants cannot",
	async (access) => {
		const f = await fixture(access);
		const client = f.createClient();
		try {
			const ready = deferred();
			const allowed = client.subscribe(workspaceChanges, {
				params: { workspaceId: f.workspaceId },
				onEvent() {},
				onSync: () => ready.resolve(),
			});
			await ready.promise;
			allowed.unsubscribe();
			await until(() => f.bus.subscriberCount() === 0);
			for (const [channel, params] of [
				[workspaceChanges, { workspaceId: "other-workspace" }],
				[
					workspaceFavorites,
					{ workspaceId: f.workspaceId, userId: "other-user" },
				],
			] as const) {
				const denied = deferred<unknown>();
				const subscription = client.subscribe(channel, {
					params,
					onEvent() {},
					onSync() {},
					onError: denied.resolve,
				});
				expect(await denied.promise).toMatchObject({ status: 403 });
				subscription.unsubscribe();
				expect(f.bus.subscriberCount()).toBe(0);
			}
			const legacy = f.createClient((await f.login()).token);
			try {
				const denied = deferred<unknown>();
				legacy.subscribe(workspaceChanges, {
					params: { workspaceId: f.workspaceId },
					onEvent() {},
					onSync() {},
					onError: denied.resolve,
				});
				expect(await denied.promise).toMatchObject({ status: 403 });
				expect(f.bus.subscriberCount()).toBe(0);
			} finally {
				legacy.close();
			}
			await f.database.db.delete(schema.oauthConsent);
			const denied = deferred<unknown>();
			client.subscribe(workspaceChanges, {
				params: { workspaceId: f.workspaceId },
				onEvent() {},
				onSync() {},
				onError: denied.resolve,
			});
			expect(await denied.promise).toMatchObject({ status: 401 });
			expect(f.bus.subscriberCount()).toBe(0);
		} finally {
			client.close();
			await f.close();
		}
	},
);

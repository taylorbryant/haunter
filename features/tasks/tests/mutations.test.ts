import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	spyOn,
	test,
} from "bun:test";
import {
	onlineManager,
	QueryClient,
	QueryClientProvider,
	QueryObserver,
} from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import {
	installSessionRecovery,
	SessionRecovery,
	type VerifiedSession,
	WorkspaceAccessError,
} from "@/client/session-recovery";
import { createWorkspaceRefreshGate } from "@/features/collab/client/refresh-gate";
import { listNotificationsQueryOptions } from "@/features/notifications/client/queries";
import type {
	ListNotificationsOutput,
	Notification,
} from "@/features/notifications/schemas";
import {
	getPageMetadataQueryOptions,
	getPageQueryOptions,
	listPagesQueryOptions,
} from "@/features/pages/client/queries";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import { createTaskMutations, runTaskMutation } from "../client/mutations";
import { invalidateTasks, listTasksQueryOptions } from "../client/queries";
import { useTaskRefetchOptions } from "../client/use-task-refetch-options";
import {
	hasPendingTaskWrite,
	TASK_WRITE_KEY,
	type TaskWriteIdentity,
	taskAwareRefetchOptions,
	taskWriteIdentity,
} from "../client/write-state";
import type { ListTasksOutput, TaskWithPage } from "../schemas";

beforeAll(installTestDom);
afterAll(uninstallTestDom);
const cleanups: Array<() => void> = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
	onlineManager.setOnline(true);
});

function client() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: Infinity } },
	});
	cleanups.push(() => queryClient.clear());
	return queryClient;
}
async function until(check: () => boolean) {
	for (let attempt = 0; attempt < 200; attempt++) {
		if (check()) return;
		await Bun.sleep(5);
	}
	throw new Error("Expected state was not reached");
}
const identity: TaskWriteIdentity = {
	userId: "user_1",
	workspaceId: "workspace_1",
	taskId: "task_1",
	pageId: null,
};
function write(
	queryClient: QueryClient,
	options: Partial<TaskWriteIdentity>,
	request: () => Promise<void>,
) {
	return runTaskMutation({
		queryClient,
		identity: { ...identity, ...options },
		operation: "test",
		variables: undefined,
		request,
		optimistic: async () => undefined,
		rollback() {},
	});
}
function mockFetch(
	implementation: (
		input: RequestInfo | URL,
		init?: RequestInit,
	) => Promise<Response>,
) {
	const mocked = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(implementation, { preconnect: fetch.preconnect }),
	);
	cleanups.push(() => mocked.mockRestore());
	return mocked;
}

describe("task mutation lifecycle", () => {
	test("serializes optimism, request and rollback for the same task, including notification actions", async () => {
		const queryClient = client();
		const firstResponse = Promise.withResolvers<void>();
		const order: string[] = [];
		const options = { queryClient, identity, variables: undefined };
		const first = runTaskMutation({
			...options,
			operation: "update",
			optimistic: async () => {
				order.push("first optimistic");
				return 1;
			},
			request: () => firstResponse.promise,
			rollback: (value) => {
				order.push(`rollback ${value}`);
			},
		}).catch((error) => error);
		const second = runTaskMutation({
			...options,
			identity: { ...identity, notificationId: "notification_1" },
			operation: "notification",
			optimistic: async () => {
				order.push("second optimistic");
			},
			request: async () => {
				order.push("second request");
			},
			rollback() {},
		});
		await until(() => order.length === 1);
		expect(order).toEqual(["first optimistic"]);
		const pending = queryClient
			.getMutationCache()
			.findAll({ mutationKey: TASK_WRITE_KEY, status: "pending" });
		expect(pending).toHaveLength(2);
		expect(pending[1]?.state.isPaused).toBe(true);
		if (!pending[1]) throw new Error("Missing queued mutation");
		expect(taskWriteIdentity(pending[1])?.notificationId).toBe(
			"notification_1",
		);
		expect(
			hasPendingTaskWrite(queryClient, "user_1", "workspace_1", "task_1"),
		).toBe(true);
		const failure = new Error("Save failed");
		firstResponse.reject(failure);
		expect(await first).toBe(failure);
		await second;
		expect(order).toEqual([
			"first optimistic",
			"rollback 1",
			"second optimistic",
			"second request",
		]);
		expect(queryClient.isMutating()).toBe(0);
	});

	test("allows unrelated resources to save concurrently and scopes refresh blocking", async () => {
		const queryClient = client();
		const pending = Promise.withResolvers<void>();
		const first = write(
			queryClient,
			{ pageId: "page_1" },
			() => pending.promise,
		);
		let concurrentWrites = 0;
		await Promise.all([
			write(queryClient, { taskId: "task_2" }, async () => {
				concurrentWrites++;
			}),
			write(queryClient, { workspaceId: "workspace_2" }, async () => {
				concurrentWrites++;
			}),
			write(queryClient, { userId: "user_2" }, async () => {
				concurrentWrites++;
			}),
		]);
		expect(concurrentWrites).toBe(3);
		const gate = createWorkspaceRefreshGate(queryClient);
		const keys = [
			[listTasksQueryOptions("workspace_1", "open").queryKey, true],
			[listTasksQueryOptions("workspace_2", "open").queryKey, false],
			[getPageQueryOptions("page_1").queryKey, true],
			[getPageMetadataQueryOptions("page_1").queryKey, true],
			[getPageQueryOptions("page_2").queryKey, false],
			[listPagesQueryOptions("workspace_1").queryKey, false],
			[listNotificationsQueryOptions().queryKey, true],
		] as const;
		const refetch = taskAwareRefetchOptions(queryClient);
		for (const [queryKey, blocked] of keys) {
			queryClient.setQueryData(queryKey, {});
			const query = queryClient.getQueryCache().find({ queryKey, exact: true });
			if (!query) throw new Error("Missing query");
			expect(gate.isBlocked(query)).toBe(blocked);
			expect(refetch.refetchOnWindowFocus(query)).toBe(!blocked);
			expect(refetch.refetchOnReconnect(query)).toBe(!blocked);
			expect(refetch.refetchOnMount(query)).toBe(!blocked);
			expect(refetch.refetchInterval(query)).toBe(blocked ? false : 30_000);
		}
		pending.resolve();
		await first;
	});

	test("coalesces local refreshes until all related writes settle without deadlocking onSettled", async () => {
		const queryClient = client();
		const queryKey = listTasksQueryOptions("workspace_1", "all").queryKey;
		let fetches = 0;
		const observer = new QueryObserver(queryClient, {
			queryKey,
			initialData: { items: [], hasMore: false },
			queryFn: async () => {
				fetches++;
				return { items: [], hasMore: false };
			},
		});
		cleanups.push(observer.subscribe(() => {}));
		const firstResponse = Promise.withResolvers<void>();
		const secondResponse = Promise.withResolvers<void>();
		const first = write(queryClient, {}, () => firstResponse.promise);
		const second = write(
			queryClient,
			{ taskId: "task_2" },
			() => secondResponse.promise,
		);
		const refresh = Promise.all([
			invalidateTasks(queryClient, "workspace_1"),
			invalidateTasks(queryClient, "workspace_1"),
		]);
		firstResponse.resolve();
		await first;
		expect(fetches).toBe(0);
		secondResponse.resolve();
		await second;
		await refresh;
		expect(fetches).toBe(1);
		expect(queryClient.isMutating()).toBe(0);
	});

	test("a hint during an existing fetch causes a later fetch", async () => {
		const queryClient = client();
		const queryKey = listTasksQueryOptions("workspace_1", "all").queryKey;
		const response = Promise.withResolvers<string>();
		let fetches = 0;
		const observer = new QueryObserver(queryClient, {
			queryKey,
			initialData: "cached",
			queryFn: () =>
				++fetches === 1 ? response.promise : Promise.resolve("fresh"),
		});
		cleanups.push(observer.subscribe(() => {}));
		const oldFetch = observer.refetch();
		const refresh = invalidateTasks(queryClient, "workspace_1");
		expect(fetches).toBe(1);
		response.resolve("old");
		await oldFetch;
		await refresh;
		expect(fetches).toBe(2);
		expect(queryClient.getQueryData<string>(queryKey)).toBe("fresh");
	});

	test("drops queued refreshes if the query is removed and recreated", async () => {
		const queryClient = client();
		const queryKey = listTasksQueryOptions("workspace_1", "all").queryKey;
		queryClient.setQueryData(queryKey, "old account");
		const response = Promise.withResolvers<void>();
		const pending = write(queryClient, {}, () => response.promise);
		const refresh = invalidateTasks(queryClient, "workspace_1");
		queryClient.removeQueries({ queryKey, exact: true });
		queryClient.setQueryData(queryKey, "new account");
		await refresh;
		expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(false);
		response.resolve();
		await pending;
	});

	test("tracks offline queued writes and releases them through React Query", async () => {
		const queryClient = client();
		onlineManager.setOnline(false);
		let calls = 0;
		const pending = write(queryClient, {}, async () => {
			calls++;
		});
		await until(
			() => queryClient.getMutationCache().getAll()[0]?.state.isPaused === true,
		);
		expect(
			hasPendingTaskWrite(queryClient, "user_1", "workspace_1", "task_1"),
		).toBe(true);
		expect(calls).toBe(0);
		onlineManager.setOnline(true);
		await queryClient.resumePausedMutations();
		await pending;
		expect(calls).toBe(1);
		expect(queryClient.isMutating()).toBe(0);
	});

	test("browser reconnection waits for same-account verification and sends queued writes once in order", async () => {
		const queryClient = client();
		const session = {
			userId: "user_1",
			workspaceId: "workspace_1",
			role: "member",
		};
		const verification = Promise.withResolvers<VerifiedSession>();
		let checks = 0;
		const recovery = new SessionRecovery(
			"user_1",
			() => {
				checks++;
				return verification.promise;
			},
			session,
		);
		cleanups.push(installSessionRecovery(recovery));
		const onOnline = () => {
			void recovery.recheck();
		};
		window.addEventListener("online", onOnline);
		cleanups.push(() => window.removeEventListener("online", onOnline));
		queryClient.mount();
		cleanups.push(() => queryClient.unmount());
		onlineManager.setOnline(false);
		const requests: string[] = [];
		const first = write(queryClient, {}, async () => {
			requests.push("first");
		});
		const second = write(queryClient, {}, async () => {
			requests.push("second");
		});
		await until(() => queryClient.isMutating() === 2);
		window.dispatchEvent(new Event("online"));
		await until(() => checks === 1);
		expect(requests).toEqual([]);
		expect(queryClient.isMutating()).toBe(2);
		verification.resolve(session);
		await Promise.all([first, second]);
		expect(requests).toEqual(["first", "second"]);
		expect(recovery.getSnapshot().status).toBe("authenticated");
		expect(queryClient.isMutating()).toBe(0);
	});

	test("queued writes can start after same-account verification has already finished", async () => {
		const queryClient = client();
		const session = {
			userId: "user_1",
			workspaceId: "workspace_1",
			role: "member",
		};
		const recovery = new SessionRecovery(
			"user_1",
			async () => session,
			session,
		);
		cleanups.push(installSessionRecovery(recovery));
		onlineManager.setOnline(false);
		let requests = 0;
		const pending = write(queryClient, {}, async () => {
			requests++;
		});
		await until(() => queryClient.isMutating() === 1);
		expect(await recovery.recheck()).toBe(true);
		onlineManager.setOnline(true);
		await queryClient.resumePausedMutations();
		await pending;
		expect(requests).toBe(1);
	});

	test("an unsent write follows a newer verification when its first check is superseded", async () => {
		const queryClient = client();
		const session = {
			userId: "user_1",
			workspaceId: "workspace_1",
			role: "member",
		};
		const verification = Promise.withResolvers<VerifiedSession>();
		let checks = 0;
		const recovery = new SessionRecovery(
			"user_1",
			(signal) => {
				checks++;
				if (checks > 1) return verification.promise;
				return new Promise((_resolve, reject) => {
					signal.addEventListener("abort", () => reject(signal.reason), {
						once: true,
					});
				});
			},
			session,
		);
		cleanups.push(installSessionRecovery(recovery));
		onlineManager.setOnline(false);
		let requests = 0;
		const pending = write(queryClient, {}, async () => {
			requests++;
		});
		const firstCheck = recovery.recheck();
		onlineManager.setOnline(true);
		const resumed = queryClient.resumePausedMutations();
		await until(() => checks === 1);
		const secondCheck = recovery.recheck();
		expect(await firstCheck).toBe(false);
		expect(requests).toBe(0);
		verification.resolve(session);
		expect(await secondCheck).toBe(true);
		await resumed;
		await pending;
		expect(requests).toBe(1);
	});

	test.each([
		"account-changed",
		"access-lost",
		"error",
		"expired",
		"replacement",
	])(
		"queued writes do not send or change caches after %s during verification",
		async (outcome) => {
			const queryClient = client();
			const session = {
				userId: "user_1",
				workspaceId: "workspace_1",
				role: "member",
			};
			const verification = Promise.withResolvers<VerifiedSession | null>();
			const recovery = new SessionRecovery(
				"user_1",
				() => verification.promise,
				session,
			);
			cleanups.push(installSessionRecovery(recovery));
			onlineManager.setOnline(false);
			let requests = 0;
			let cacheChanges = 0;
			const pending = runTaskMutation({
				queryClient,
				identity,
				operation: "update",
				variables: undefined,
				request: async () => {
					requests++;
				},
				optimistic: async () => {
					cacheChanges++;
				},
				rollback: () => {
					cacheChanges++;
				},
				committed: () => {
					cacheChanges++;
				},
			}).catch((error) => error);
			await until(() => queryClient.isMutating() === 1);
			const checking = recovery.recheck();
			onlineManager.setOnline(true);
			const resumed = queryClient.resumePausedMutations();
			await Bun.sleep(0);
			if (outcome === "access-lost")
				verification.reject(new WorkspaceAccessError());
			else if (outcome === "error") verification.reject(new Error("Offline"));
			else if (outcome === "expired") verification.resolve(null);
			else if (outcome === "account-changed")
				verification.resolve({ ...session, userId: "user_2" });
			else {
				cleanups.push(
					installSessionRecovery(
						new SessionRecovery("user_1", async () => session, session),
					),
				);
				verification.resolve(session);
			}
			await checking;
			expect(await pending).toMatchObject({ code: "SESSION_PAUSED" });
			await resumed;
			expect(requests).toBe(0);
			expect(cacheChanges).toBe(0);
		},
	);

	test.each([true, false])(
		"same-account rechecks still fence requests already sent (failure: %s)",
		async (fails) => {
			const queryClient = client();
			const session = {
				userId: "user_1",
				workspaceId: "workspace_1",
				role: "member",
			};
			let checks = 0;
			const recovery = new SessionRecovery(
				"user_1",
				async () => {
					checks++;
					return session;
				},
				session,
			);
			cleanups.push(installSessionRecovery(recovery));
			const response = Promise.withResolvers<void>();
			let requests = 0;
			let staleCacheChanges = 0;
			const first = runTaskMutation({
				queryClient,
				identity,
				operation: "update",
				variables: undefined,
				optimistic: async () => undefined,
				request: () => {
					requests++;
					return response.promise;
				},
				rollback: () => {
					staleCacheChanges++;
				},
				committed: () => {
					staleCacheChanges++;
				},
			}).catch((error) => error);
			const second = write(queryClient, {}, async () => {
				requests++;
			});
			await until(() => requests === 1);
			expect(checks).toBe(0); // Ordinary online writes do not add session requests.
			await recovery.recheck();
			if (fails) response.reject(new Error("Old response"));
			else response.resolve();
			expect(await first).toBeInstanceOf(Error);
			await second;
			expect(requests).toBe(2); // Only the previously unsent write resumes.
			expect(staleCacheChanges).toBe(0);
		},
	);

	test("does not retry an optimistic transaction or roll back a committed write after a cache callback fails", async () => {
		const queryClient = client();
		queryClient.setDefaultOptions({ mutations: { retry: 2, retryDelay: 0 } });
		let requests = 0;
		let rollbacks = 0;
		const options = {
			queryClient,
			identity,
			variables: undefined,
			operation: "test",
			optimistic: async () => undefined,
			rollback: () => {
				rollbacks++;
			},
		};
		await expect(
			runTaskMutation({
				...options,
				request: async () => {
					requests++;
					throw new Error("failed");
				},
			}),
		).rejects.toThrow("failed");
		expect(requests).toBe(1);
		expect(rollbacks).toBe(1);
		await runTaskMutation({
			...options,
			request: async () => {
				requests++;
			},
			committed: () => {
				throw new Error("cache failed");
			},
		});
		expect(requests).toBe(2);
		expect(rollbacks).toBe(1);
	});

	test.each([true, false])(
		"session changes reject old queued writes and old responses (failure: %s)",
		async (fails) => {
			const queryClient = client();
			const recovery = new SessionRecovery("user_1", async () => null, {
				workspaceId: "workspace_1",
				role: "member",
			});
			cleanups.push(installSessionRecovery(recovery));
			const response = Promise.withResolvers<void>();
			let started = 0;
			let cacheChanges = 0;
			const options = {
				queryClient,
				identity,
				operation: "update",
				variables: undefined,
				optimistic: async () => {
					started++;
				},
				rollback: () => {
					cacheChanges++;
				},
				committed: () => {
					cacheChanges++;
				},
			};
			const first = runTaskMutation({
				...options,
				request: () => response.promise,
			}).catch((error) => error);
			const second = runTaskMutation({
				...options,
				request: async () => {
					throw new Error("old queued request ran");
				},
			}).catch((error) => error);
			await until(() => started === 1);
			recovery.invalidate();
			if (fails) response.reject(new Error("old response"));
			else response.resolve();
			expect(await first).toBeInstanceOf(Error);
			expect(await second).toBeInstanceOf(Error);
			expect(started).toBe(1);
			expect(cacheChanges).toBe(0);
		},
	);
});

const task: TaskWithPage = {
	id: "31cc7263-1358-47f0-88cc-a4595ff26b0e",
	userId: "user_1",
	workspaceId: "workspace_1",
	pageId: null,
	sourceBlockId: null,
	title: "First task",
	completed: false,
	completedAt: null,
	dueDate: "2026-09-14",
	dueTime: "09:00",
	reminderOffsetMinutes: 15,
	assigneeId: "user_1",
	assigneeName: "Taylor",
	createdAt: "2026-09-13T14:00:00.000Z",
	updatedAt: "2026-09-13T14:00:00.000Z",
	pageTitle: null,
};
const actor = { id: "user_1", name: "Taylor" };

test.each(["create", "update", "delete"] as const)(
	"queued %s reconciles after canceling a reconnect fetch without losing newer cache edits",
	async (operation) => {
		const queryClient = client();
		const queryKey = listTasksQueryOptions("workspace_1", "all").queryKey;
		const other = {
			...task,
			id: "1a6aa7dd-878c-4589-af87-f5d1eec88a3d",
			title: "Other task",
		};
		const saved = { ...task, title: "Saved task" };
		const remote = { ...other, title: "Changed in another browser" };
		const fresh: ListTasksOutput = {
			items: operation === "delete" ? [remote] : [saved, remote],
			hasMore: false,
		};
		const initial: ListTasksOutput = {
			items: operation === "create" ? [other] : [task, other],
			hasMore: false,
		};
		let fetches = 0;
		let aborted = false;
		const observer = new QueryObserver(queryClient, {
			queryKey,
			initialData: initial,
			queryFn: ({ signal }): Promise<ListTasksOutput> => {
				if (++fetches > 1) return Promise.resolve(fresh);
				return new Promise((_resolve, reject) => {
					signal.addEventListener("abort", () => {
						aborted = true;
						reject(signal.reason);
					});
				});
			},
		});
		cleanups.push(observer.subscribe(() => {}));
		const session = {
			userId: actor.id,
			workspaceId: task.workspaceId,
			role: "member",
		};
		const recovery = new SessionRecovery(
			actor.id,
			async () => session,
			session,
		);
		cleanups.push(installSessionRecovery(recovery));
		const response = Promise.withResolvers<Response>();
		const requests = mockFetch(() => response.promise);
		const mutations = createTaskMutations(queryClient, actor);
		onlineManager.setOnline(false);
		const pending =
			operation === "create"
				? mutations.create(task.workspaceId, {
						title: saved.title,
						dueDate: null,
						dueTime: null,
						reminderOffsetMinutes: null,
					})
				: operation === "update"
					? mutations.update(task, { title: saved.title })
					: mutations.remove(task);
		await until(
			() => queryClient.getMutationCache().getAll()[0]?.state.isPaused === true,
		);
		expect(requests).not.toHaveBeenCalled();
		expect(await recovery.recheck()).toBe(true);
		onlineManager.setOnline(true);
		const reconnectFetch = observer.refetch();
		expect(fetches).toBe(1);
		// A cache edit made after the fetch started must survive cancellation.
		queryClient.setQueryData<ListTasksOutput>(queryKey, {
			...initial,
			items: initial.items.map((item) =>
				item.id === other.id ? { ...item, title: "Newer local edit" } : item,
			),
		});
		const resumed = queryClient.resumePausedMutations();
		await until(() => requests.mock.calls.length === 1);
		expect(aborted).toBe(true);
		expect(queryClient.getQueryState(queryKey)?.fetchStatus).toBe("idle");
		expect(
			queryClient
				.getQueryData<ListTasksOutput>(queryKey)
				?.items.find((item) => item.id === other.id)?.title,
		).toBe("Newer local edit");
		let reconciled = false;
		const refresh = invalidateTasks(queryClient, task.workspaceId).then(() => {
			reconciled = true;
		});
		await Bun.sleep(0);
		expect(reconciled).toBe(false);
		expect(fetches).toBe(1); // Still blocked by the pending write, not a stale fetch.
		response.resolve(
			operation === "delete"
				? new Response(null, { status: 204 })
				: Response.json(saved, { status: operation === "create" ? 201 : 200 }),
		);
		await Promise.all([pending, resumed, reconnectFetch]);
		await until(() => reconciled);
		await refresh;
		expect(requests).toHaveBeenCalledTimes(1);
		expect(fetches).toBe(2);
		expect(queryClient.getQueryData<ListTasksOutput>(queryKey)).toEqual(fresh);
	},
);

test("task updates use the typed transport and roll back only the failed row", async () => {
	const queryClient = client();
	const queryKey = listTasksQueryOptions("workspace_1", "all").queryKey;
	const other = {
		...task,
		id: "1a6aa7dd-878c-4589-af87-f5d1eec88a3d",
		title: "Other task",
		createdAt: "2026-09-13T15:00:00.000Z",
	};
	queryClient.setQueryData(queryKey, { items: [task, other], hasMore: false });
	const response = Promise.withResolvers<Response>();
	const requests: Array<{
		url: string;
		body: unknown;
		method: string | undefined;
	}> = [];
	mockFetch(async (url, init) => {
		requests.push({
			url: String(url),
			body: JSON.parse(String(init?.body)),
			method: init?.method,
		});
		return String(url).endsWith(task.id)
			? response.promise
			: Response.json({ ...other, title: "Saved other" });
	});
	const mutations = createTaskMutations(queryClient, actor);
	const first = mutations
		.update(task, {
			title: "Draft title",
			completed: true,
			dueDate: "2026-09-15",
		})
		.catch((error) => error);
	await until(() => requests.length === 1);
	expect(
		queryClient
			.getQueryData<ListTasksOutput>(queryKey)
			?.items.find((item) => item.id === task.id),
	).toMatchObject({
		title: "Draft title",
		completed: true,
		dueDate: "2026-09-15",
		dueTime: "09:00",
		reminderOffsetMinutes: 15,
	});
	await mutations.update(other, { title: "Saved other" });
	response.resolve(Response.json({ message: "Unavailable" }, { status: 500 }));
	await first;
	expect(queryClient.getQueryData<ListTasksOutput>(queryKey)?.items).toEqual([
		task,
		{ ...other, title: "Saved other" },
	]);
	expect(requests[0]).toMatchObject({
		method: "PATCH",
		body: { title: "Draft title", completed: true, dueDate: "2026-09-15" },
	});
});

test("concurrent creates retain the successful row, replace its temporary id and send distinct idempotency keys", async () => {
	const queryClient = client();
	const queryKey = listTasksQueryOptions("workspace_1", "open").queryKey;
	queryClient.setQueryData(queryKey, { items: [], hasMore: false });
	const failedResponse = Promise.withResolvers<Response>();
	const successfulResponse = Promise.withResolvers<Response>();
	const headers: Array<string | null> = [];
	mockFetch(async (_url, init) => {
		headers.push(new Headers(init?.headers).get("idempotency-key"));
		return headers.length === 1
			? failedResponse.promise
			: successfulResponse.promise;
	});
	const mutations = createTaskMutations(queryClient, actor);
	const input = {
		title: "Failed",
		dueDate: null,
		dueTime: null,
		reminderOffsetMinutes: null,
	};
	const first = mutations.create("workspace_1", input).catch((error) => error);
	const second = mutations.create("workspace_1", { ...input, title: "Saved" });
	await until(() => headers.length === 2);
	expect(
		queryClient.getQueryData<ListTasksOutput>(queryKey)?.items,
	).toHaveLength(2);
	successfulResponse.resolve(
		Response.json(
			{
				...task,
				title: "Saved",
				dueDate: null,
				dueTime: null,
				reminderOffsetMinutes: null,
			},
			{ status: 201 },
		),
	);
	await second;
	failedResponse.resolve(
		Response.json({ message: "Unavailable" }, { status: 500 }),
	);
	await first;
	const items = queryClient.getQueryData<ListTasksOutput>(queryKey)?.items;
	expect(items).toHaveLength(1);
	expect(items?.[0]).toMatchObject({ id: task.id, title: "Saved" });
	expect(headers.every(Boolean)).toBe(true);
	expect(new Set(headers).size).toBe(2);
});

test("creating, editing and deleting do not cancel another workspace's in-flight list", async () => {
	const queryClient = client();
	const otherResponse = Promise.withResolvers<string>();
	let aborted = false;
	const observer = new QueryObserver(queryClient, {
		queryKey: listTasksQueryOptions("workspace_2", "all").queryKey,
		queryFn: ({ signal }) => {
			signal.addEventListener("abort", () => {
				aborted = true;
			});
			return otherResponse.promise;
		},
	});
	cleanups.push(observer.subscribe(() => {}));
	mockFetch(async (_url, init) =>
		init?.method === "DELETE"
			? new Response(null, { status: 204 })
			: Response.json(task, { status: init?.method === "POST" ? 201 : 200 }),
	);
	const mutations = createTaskMutations(queryClient, actor);
	await mutations.create("workspace_1", {
		title: "Created",
		dueDate: null,
		dueTime: null,
		reminderOffsetMinutes: null,
	});
	await mutations.update(task, { title: "Edited" });
	await mutations.remove(task);
	expect(aborted).toBe(false);
	expect(observer.getCurrentResult().fetchStatus).toBe("fetching");
	otherResponse.resolve("Loaded other workspace");
	await until(
		() => observer.getCurrentResult().data === "Loaded other workspace",
	);
});

test("mounted polling consumers recalculate when task writes start and settle", async () => {
	const queryClient = client();
	const queryKey = getPageMetadataQueryOptions("page_1").queryKey;
	queryClient.setQueryData(queryKey, {});
	const query = queryClient.getQueryCache().find({ queryKey });
	if (!query) throw new Error("Missing query");
	const hook = renderHook(
		() => useTaskRefetchOptions().refetchInterval(query),
		{
			wrapper: ({ children }: { children: ReactNode }) =>
				createElement(QueryClientProvider, { client: queryClient }, children),
		},
	);
	cleanups.push(() => hook.unmount());
	expect(hook.result.current).toBe(30_000);
	const response = Promise.withResolvers<void>();
	let pending!: Promise<void>;
	await act(async () => {
		pending = write(queryClient, { pageId: "page_1" }, () => response.promise);
		await Bun.sleep(5);
	});
	expect(hook.result.current).toBe(false);
	await act(async () => {
		response.resolve();
		await pending;
		await Bun.sleep(5);
	});
	expect(hook.result.current).toBe(30_000);
});

test("notification actions use the same task scope and preserve Beignet idempotency", async () => {
	const queryClient = client();
	const item: Notification = {
		id: "4f9859fe-8aa4-48cf-b2d7-e382f709e784",
		userId: task.userId,
		workspaceId: task.workspaceId,
		kind: "task.overdue",
		entityId: task.id,
		entityVersion: "version_1",
		readAt: null,
		createdAt: task.createdAt,
		payload: {
			taskId: task.id,
			title: task.title,
			dueDate: "2026-09-14",
			dueTime: task.dueTime,
			pageId: null,
			sourceBlockId: null,
		},
		actionState: null,
		actionAt: null,
		snoozedUntil: null,
		taskCompleted: false,
		taskAssigneeId: task.assigneeId,
		taskAvailable: true,
		taskCanComplete: true,
	};
	const inbox = listNotificationsQueryOptions().queryKey;
	queryClient.setQueryData<ListNotificationsOutput>(inbox, {
		items: [item],
		unreadCount: 1,
		nextCursor: null,
	});
	const firstResponse = Promise.withResolvers<Response>();
	const requests: RequestInit[] = [];
	mockFetch(async (_url, init) => {
		requests.push(init ?? {});
		return requests.length === 1
			? firstResponse.promise
			: Response.json({
					action: "snooze",
					notificationId: item.id,
					taskId: task.id,
					workspaceId: task.workspaceId,
					pageId: null,
					snoozedUntil: "2026-09-13T18:00:00.000Z",
					unreadCount: 0,
				});
	});
	const mutations = createTaskMutations(queryClient, actor);
	const first = mutations.update(task, { title: "Edited" });
	const second = mutations.actOnNotification(item, {
		action: "snooze",
		preset: "1h",
	});
	await until(() => requests.length === 1);
	expect(
		queryClient.getQueryData<ListNotificationsOutput>(inbox)?.items,
	).toHaveLength(1);
	firstResponse.resolve(Response.json({ ...task, title: "Edited" }));
	await Promise.all([first, second]);
	expect(requests).toHaveLength(2);
	expect(requests[1]?.method).toBe("POST");
	expect(JSON.parse(String(requests[1]?.body))).toEqual({
		action: "snooze",
		preset: "1h",
	});
	expect(new Headers(requests[1]?.headers).get("idempotency-key")).toBeTruthy();
	expect(
		queryClient.getQueryData<ListNotificationsOutput>(inbox)?.items,
	).toEqual([]);
});

import { afterEach, describe, expect, it } from "bun:test";
import {
	MutationObserver,
	QueryClient,
	QueryObserver,
} from "@tanstack/react-query";
import {
	getCanvasQueryOptions,
	listCanvasesQueryOptions,
} from "@/features/canvases/client/queries";
import { listNotificationsQueryOptions } from "@/features/notifications/client/queries";
import {
	getPageQueryOptions,
	listPagesQueryOptions,
} from "@/features/pages/client/queries";
import { listTasksQueryOptions } from "@/features/tasks/client/queries";
import { TASK_WRITE_KEY } from "@/features/tasks/client/write-state";
import { subscribeToWorkspaceChanges } from "../client/broadcasts";
import { createWorkspaceRefreshGate } from "../client/refresh-gate";
import {
	createWorkspaceCanvasEvent,
	createWorkspacePageEvent,
	createWorkspaceTaskEvent,
} from "../workspace-events";
import { controlledBroadcastClient, deferred, until } from "./helpers";

const cleanups: Array<() => void> = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function fixture() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: Infinity } },
	});
	cleanups.push(() => queryClient.clear());
	const writeTask = async (taskId: string, request: () => Promise<void>) => {
		const observer = new MutationObserver(queryClient, {
			mutationKey: [...TASK_WRITE_KEY, "user_1", "workspace_1", taskId],
			meta: {
				taskWrite: {
					userId: "user_1",
					workspaceId: "workspace_1",
					taskId,
					pageId: null,
				},
			},
			mutationFn: request,
		});
		try {
			await observer.mutate();
		} finally {
			observer.reset();
		}
	};
	const broadcast = controlledBroadcastClient();
	const removed: string[] = [];
	let currentPageId = "open_page";
	const unsubscribe = subscribeToWorkspaceChanges({
		client: broadcast.client,
		queryClient,
		workspaceId: "workspace_1",
		getCurrentPageId: () => currentPageId,
		onPageRemoved: (pageId) => {
			removed.push(pageId);
		},
		refreshGate: createWorkspaceRefreshGate(queryClient),
	});
	cleanups.push(unsubscribe);
	return {
		...broadcast,
		queryClient,
		writeTask,
		removed,
		unsubscribe,
		navigate(pageId: string) {
			currentPageId = pageId;
		},
	};
}

describe("workspace broadcast cache", () => {
	it("coalesces hints and renewal behind pending optimistic mutations", async () => {
		const f = fixture();
		const key = listPagesQueryOptions("workspace_1").queryKey;
		let fetches = 0;
		const observer = new QueryObserver(f.queryClient, {
			queryKey: key,
			initialData: { items: [] },
			queryFn: async () => {
				fetches++;
				return { items: [{ id: "open_page" }] };
			},
		});
		cleanups.push(observer.subscribe(() => {}));
		const pending = deferred();
		const mutation = f.queryClient
			.getMutationCache()
			.build(f.queryClient, { mutationFn: () => pending.promise });
		const write = mutation.execute(undefined);
		await f.sync();
		await f.event(
			createWorkspacePageEvent({
				workspaceId: "workspace_1",
				pageId: "open_page",
				type: "page.renamed",
			}),
		);
		await f.event(
			createWorkspacePageEvent({
				workspaceId: "workspace_1",
				pageId: "open_page",
				type: "page.iconChanged",
			}),
		);
		expect(fetches).toBe(0);
		expect(f.queryClient.getQueryState(key)?.isInvalidated).toBe(false);
		expect(f.removed).toEqual([]);
		pending.resolve();
		await write;
		await until(() => fetches === 1);
		expect(f.removed).toEqual([]);
	});

	it("waits for task writes but allows unrelated page refreshes", async () => {
		const f = fixture();
		const tasks = listTasksQueryOptions("workspace_1", "open").queryKey;
		const pages = listPagesQueryOptions("workspace_1").queryKey;
		f.queryClient.setQueryData(tasks, { items: [], hasMore: false });
		f.queryClient.setQueryData(pages, { items: [] });
		const pending = deferred();
		const write = f.writeTask("task_1", () => pending.promise);
		await f.sync();
		expect(f.queryClient.getQueryState(tasks)?.isInvalidated).toBe(false);
		expect(f.queryClient.getQueryState(pages)?.isInvalidated).toBe(true);
		pending.resolve();
		await write;
		await until(
			() => f.queryClient.getQueryState(tasks)?.isInvalidated === true,
		);
	});

	it("drops queued work on workspace/session cleanup", async () => {
		const f = fixture();
		const key = listTasksQueryOptions("workspace_1", "open").queryKey;
		f.queryClient.setQueryData(key, { items: [], hasMore: false });
		const pending = deferred();
		const write = f.writeTask("task_1", () => pending.promise);
		await f.event(
			createWorkspaceTaskEvent({
				workspaceId: "workspace_1",
				taskId: "task_1",
			}),
		);
		f.unsubscribe();
		pending.resolve();
		await write;
		expect(f.queryClient.getQueryState(key)?.isInvalidated).toBe(false);
	});

	it("invalidates affected details and scoped lists, including inactive queries", async () => {
		const f = fixture();
		const keys = {
			page: getPageQueryOptions("root").queryKey,
			child: getPageQueryOptions("child").queryKey,
			tasks: listTasksQueryOptions("workspace_1", "open").queryKey,
			notifications: listNotificationsQueryOptions().queryKey,
			canvas: getCanvasQueryOptions("canvas_1").queryKey,
			canvases: listCanvasesQueryOptions("workspace_1").queryKey,
			other: listCanvasesQueryOptions("workspace_2").queryKey,
		};
		for (const key of Object.values(keys)) f.queryClient.setQueryData(key, {});
		await f.event(
			createWorkspacePageEvent({
				workspaceId: "workspace_1",
				pageId: "root",
				affectedPageIds: ["root", "child"],
				type: "page.trashed",
			}),
		);
		await f.event(
			createWorkspaceCanvasEvent({
				workspaceId: "workspace_1",
				canvasId: "canvas_1",
				pageId: null,
			}),
		);
		for (const [name, key] of Object.entries(keys))
			expect(f.queryClient.getQueryState(key)?.isInvalidated).toBe(
				name !== "other",
			);
	});

	it("ignores hints for a different workspace and navigates for a deleted ancestor", async () => {
		const f = fixture();
		await f.event(
			createWorkspacePageEvent({
				workspaceId: "workspace_2",
				pageId: "open_page",
				type: "page.trashed",
			}),
		);
		expect(f.removed).toEqual([]);
		await f.event(
			createWorkspacePageEvent({
				workspaceId: "workspace_1",
				pageId: "ancestor",
				affectedPageIds: ["ancestor", "open_page"],
				type: "page.trashed",
			}),
		);
		expect(f.removed).toEqual(["open_page"]);
	});

	it("does not mistake a fetch begun before reconnect for an authoritative deletion", async () => {
		const f = fixture();
		const key = listPagesQueryOptions("workspace_1").queryKey;
		const oldResponse = deferred<{ items: { id: string }[] }>();
		const freshResponse = deferred<{ items: { id: string }[] }>();
		let fetches = 0;
		const observer = new QueryObserver(f.queryClient, {
			queryKey: key,
			initialData: { items: [] },
			queryFn: () =>
				++fetches === 1 ? oldResponse.promise : freshResponse.promise,
		});
		cleanups.push(observer.subscribe(() => {}));
		const oldFetch = observer.refetch();
		await f.sync();
		await f.sync();
		expect(fetches).toBe(1);
		oldResponse.resolve({ items: [] });
		await oldFetch;
		await until(() => fetches === 2);
		expect(f.removed).toEqual([]);
		freshResponse.resolve({ items: [{ id: "open_page" }] });
		await until(() => f.queryClient.getQueryState(key)?.fetchStatus === "idle");
		expect(f.removed).toEqual([]);
		expect(fetches).toBe(2);
	});

	it("checks a missed deletion only after the post-reconnect fetch succeeds", async () => {
		const f = fixture();
		const key = listPagesQueryOptions("workspace_1").queryKey;
		const response = deferred<{ items: { id: string }[] }>();
		const observer = new QueryObserver(f.queryClient, {
			queryKey: key,
			initialData: { items: [{ id: "open_page" }] },
			queryFn: () => response.promise,
		});
		cleanups.push(observer.subscribe(() => {}));
		await f.sync();
		f.queryClient.setQueryData(key, { items: [] });
		expect(f.removed).toEqual([]);
		response.resolve({ items: [] });
		await until(() => f.removed.length === 1);
		expect(f.removed).toEqual(["open_page"]);
	});

	it("does not navigate after an unsuccessful reconciliation", async () => {
		const f = fixture();
		const key = listPagesQueryOptions("workspace_1").queryKey;
		const observer = new QueryObserver(f.queryClient, {
			queryKey: key,
			initialData: { items: [] },
			queryFn: async () => {
				throw new Error("offline");
			},
		});
		cleanups.push(observer.subscribe(() => {}));
		await f.sync();
		await until(() => f.queryClient.getQueryState(key)?.status === "error");
		expect(f.removed).toEqual([]);
	});

	it("does not apply a reconnect deletion check to a newly opened page", async () => {
		const f = fixture();
		const key = listPagesQueryOptions("workspace_1").queryKey;
		const response = deferred<{ items: { id: string }[] }>();
		const observer = new QueryObserver(f.queryClient, {
			queryKey: key,
			initialData: { items: [{ id: "open_page" }] },
			queryFn: () => response.promise,
		});
		cleanups.push(observer.subscribe(() => {}));
		await f.sync();
		f.navigate("new_page");
		response.resolve({ items: [] });
		await until(() => f.queryClient.getQueryState(key)?.fetchStatus === "idle");
		expect(f.removed).toEqual([]);
	});
});

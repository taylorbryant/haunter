import {
	afterAll,
	afterEach,
	beforeAll,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import { buildPageTreeIndex } from "../client/page-tree-controller";
import {
	getPageMetadataQueryOptions,
	getPageNavigationQueryOptions,
	listPagesQueryOptions,
	setPageTitleInCache,
} from "../client/queries";
import { registerPageSaveFlusher } from "../client/save-state";
import { usePageTreeMove } from "../client/use-page-tree-move";
import { usePageTreeRename } from "../client/use-page-tree-rename";
import {
	PAGE_TITLE_MAX_LENGTH,
	PAGE_TITLE_TOO_LONG_MESSAGE,
	type PageMeta,
	type PageNavigationOutput,
} from "../schemas";

const page: PageMeta = {
	id: "00000000-0000-4000-8000-000000000001",
	workspaceId: "workspace",
	userId: "user",
	parentPageId: null,
	title: "Original",
	icon: null,
	position: 1,
	deletedAt: null,
	createdAt: "2026-10-15T12:00:00.000Z",
	updatedAt: "2026-10-15T12:00:00.000Z",
};
const target: PageMeta = {
	...page,
	id: "00000000-0000-4000-8000-000000000002",
	title: "Target",
	position: 2,
};
const child: PageMeta = {
	...page,
	id: "00000000-0000-4000-8000-000000000003",
	parentPageId: page.id,
};
const index = buildPageTreeIndex([page, target, child]);
const clients: QueryClient[] = [];
const disposals: Array<() => void> = [];
beforeAll(installTestDom);
afterEach(() => {
	cleanup();
	for (const dispose of disposals.splice(0)) dispose();
	for (const client of clients.splice(0)) client.clear();
	mock.restore();
});
afterAll(uninstallTestDom);

function setup() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	clients.push(client);
	const listKey = listPagesQueryOptions(page.workspaceId).queryKey;
	const metadataKey = getPageMetadataQueryOptions(page.id).queryKey;
	const navigationKey = getPageNavigationQueryOptions(
		page.workspaceId,
	).queryKey;
	client.setQueryData(listKey, { items: [page, target, child] });
	client.setQueryData(metadataKey, page);
	client.setQueryData(navigationKey, { favorites: [page], recents: [page] });
	const requested = Promise.withResolvers<void>();
	const request = mock(async (_input: RequestInfo | URL, init?: RequestInit) =>
		Response.json({ ...page, ...JSON.parse(String(init?.body)) }),
	);
	spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			(input: RequestInfo | URL, init?: RequestInit) => {
				requested.resolve();
				return request(input, init);
			},
			{ preconnect: fetch.preconnect },
		),
	);
	const onExpand = mock((_pageId: string) => {});
	const onError = mock((_message: string | null) => {});
	const hook = renderHook(
		() => ({
			rename: usePageTreeRename({
				workspaceId: page.workspaceId,
				nodesById: index.nodesById,
			}),
			move: usePageTreeMove({ index, expanded: {}, onExpand, onError }),
		}),
		{
			wrapper: ({ children }: { children: ReactNode }) => (
				<QueryClientProvider client={client}>{children}</QueryClientProvider>
			),
		},
	);
	return {
		...hook,
		client,
		listKey,
		request,
		requested: requested.promise,
		onExpand,
		onError,
		listed: () => client.getQueryData<{ items: PageMeta[] }>(listKey)!.items[0],
		titles: () => [
			client.getQueryData<PageMeta>(metadataKey)!.title,
			client.getQueryData<{ items: PageMeta[] }>(listKey)!.items[0].title,
			client.getQueryData<PageNavigationOutput>(navigationKey)!.favorites[0]
				.title,
			client.getQueryData<PageNavigationOutput>(navigationKey)!.recents[0]
				.title,
		],
	};
}

test("rename waits for saves, coalesces Enter and blur, and reconciles the server title", async () => {
	const f = setup();
	const save = Promise.withResolvers<boolean>();
	const response = Promise.withResolvers<Response>();
	const flush = mock(() => save.promise);
	disposals.push(registerPageSaveFlusher(page.id, flush));
	f.request.mockImplementationOnce(() => response.promise);
	act(() => {
		f.result.current.rename.start(index.nodesById.get(page.id)!);
		f.result.current.rename.change("  Renamed  ");
	});
	let pending!: Promise<void>;
	await act(async () => {
		pending = f.result.current.rename.commit(page.id);
		await f.result.current.rename.commit(page.id);
	});
	expect(flush).toHaveBeenCalledTimes(1);
	expect(f.request).not.toHaveBeenCalled();
	expect(f.titles()).toEqual(Array(4).fill("Original"));
	await act(async () => {
		save.resolve(true);
		await f.requested;
	});
	expect(f.titles()).toEqual(Array(4).fill("Renamed"));
	expect(f.request.mock.calls[0][1]?.method).toBe("PATCH");
	expect(JSON.parse(String(f.request.mock.calls[0][1]?.body))).toEqual({
		title: "Renamed",
	});
	await act(async () => {
		response.resolve(Response.json({ ...page, title: "Server title" }));
		await pending;
	});
	expect(f.titles()).toEqual(Array(4).fill("Server title"));
	expect(f.result.current.rename.pageId).toBeNull();
	expect(f.result.current.rename.error).toBeNull();
	expect(f.client.getQueryState(f.listKey)?.isInvalidated).toBe(true);
});

for (const failure of ["false", "rejection"] as const) {
	test(`a ${failure} from the save prevents rename and permits retry`, async () => {
		const f = setup();
		const flush = mock(async () => true);
		if (failure === "false") flush.mockResolvedValueOnce(false);
		else flush.mockRejectedValueOnce(new Error("Save failed"));
		disposals.push(registerPageSaveFlusher(page.id, flush));
		act(() => {
			f.result.current.rename.start(index.nodesById.get(page.id)!);
			f.result.current.rename.change("Retry title");
		});
		await act(async () => f.result.current.rename.commit(page.id));
		expect(f.request).not.toHaveBeenCalled();
		expect(f.titles()).toEqual(Array(4).fill("Original"));
		expect(f.result.current.rename.pageId).toBe(page.id);
		expect(f.result.current.rename.error?.message).toBe(
			failure === "false"
				? "Save the current page before renaming it."
				: "The current page could not be saved before renaming.",
		);
		await act(async () => f.result.current.rename.commit(page.id));
		expect(f.request).toHaveBeenCalledTimes(1);
		expect(f.titles()).toEqual(Array(4).fill("Retry title"));
	});
}

test("rename validates long titles and cancels empty titles without a write", async () => {
	const f = setup();
	act(() => {
		f.result.current.rename.start(index.nodesById.get(page.id)!);
		f.result.current.rename.change("x".repeat(PAGE_TITLE_MAX_LENGTH + 1));
	});
	await act(async () => f.result.current.rename.commit(page.id));
	expect(f.result.current.rename.error?.message).toBe(
		PAGE_TITLE_TOO_LONG_MESSAGE,
	);
	act(() => f.result.current.rename.change("   "));
	await act(async () => f.result.current.rename.commit(page.id));
	expect(f.result.current.rename.pageId).toBeNull();
	expect(f.result.current.rename.error).toBeNull();
	expect(f.request).not.toHaveBeenCalled();
});

for (const concurrentEdit of [false, true]) {
	test(`failed rename restores the post-save title and preserves a concurrent edit: ${concurrentEdit}`, async () => {
		const f = setup();
		const response = Promise.withResolvers<Response>();
		f.request.mockImplementationOnce(() => response.promise);
		disposals.push(
			registerPageSaveFlusher(page.id, async () => {
				setPageTitleInCache(
					f.client,
					page.id,
					"Flushed title",
					"2026-10-15T13:00:00.000Z",
				);
				return true;
			}),
		);
		act(() => {
			f.result.current.rename.start(index.nodesById.get(page.id)!);
			f.result.current.rename.change("Optimistic");
		});
		let pending!: Promise<void>;
		await act(async () => {
			pending = f.result.current.rename.commit(page.id);
			await f.requested;
		});
		expect(f.titles()).toEqual(Array(4).fill("Optimistic"));
		await act(async () => {
			if (concurrentEdit)
				setPageTitleInCache(f.client, page.id, "Collaborator title");
			response.reject(new Error("Network unavailable"));
			await pending;
		});
		expect(f.titles()).toEqual(
			Array(4).fill(concurrentEdit ? "Collaborator title" : "Flushed title"),
		);
		expect(f.result.current.rename.pageId).toBe(page.id);
		expect(f.result.current.rename.value).toBe("Optimistic");
		expect(f.result.current.rename.error?.message).toBe("Network unavailable");
	});
}

test("move rejects self, descendant, missing targets, and unchanged placements", async () => {
	const f = setup();
	act(() => f.result.current.move.startDrag(page.id));
	await act(async () => {
		await f.result.current.move.commit(page.id, page.id, "inside");
		await f.result.current.move.commit(page.id, child.id, "inside");
		await f.result.current.move.commit(page.id, "missing", "inside");
		await f.result.current.move.commit(page.id, target.id, "before");
	});
	expect(f.request).not.toHaveBeenCalled();
	expect(f.onExpand).not.toHaveBeenCalled();
	expect(f.listed()).toEqual(page);
});

test("move updates placement once, expands the target, and clears drag feedback", async () => {
	const f = setup();
	const response = Promise.withResolvers<Response>();
	f.request.mockImplementationOnce(() => response.promise);
	act(() => f.result.current.move.startDrag(page.id));
	act(() => f.result.current.move.hover(target.id, "inside"));
	expect(f.result.current.move.dropTarget).toEqual({
		id: target.id,
		zone: "inside",
	});
	let pending!: Promise<void>;
	await act(async () => {
		pending = f.result.current.move.commit(page.id, target.id, "inside");
		await f.result.current.move.commit(page.id, target.id, "inside");
		f.result.current.move.endDrag();
		await f.requested;
	});
	expect(f.result.current.move.dragId).toBeNull();
	expect(f.result.current.move.dropTarget).toBeNull();
	expect(f.onExpand.mock.calls).toEqual([[target.id]]);
	expect(f.listed().parentPageId).toBe(target.id);
	expect(JSON.parse(String(f.request.mock.calls[0][1]?.body))).toEqual({
		parentPageId: target.id,
		position: 1,
	});
	await act(async () => {
		response.resolve(Response.json({ ...page, parentPageId: target.id }));
		await pending;
	});
	expect(f.listed().parentPageId).toBe(target.id);
	expect(f.onError.mock.calls).toEqual([[null]]);
	expect(f.client.getQueryState(f.listKey)?.isInvalidated).toBe(true);
});

for (const concurrentMove of [false, true]) {
	test(`failed move rolls back without overwriting a concurrent move: ${concurrentMove}`, async () => {
		const f = setup();
		const response = Promise.withResolvers<Response>();
		f.request.mockImplementationOnce(() => response.promise);
		act(() => f.result.current.move.startDrag(page.id));
		let pending!: Promise<void>;
		await act(async () => {
			pending = f.result.current.move.commit(page.id, target.id, "inside");
			await f.requested;
		});
		expect(f.listed().parentPageId).toBe(target.id);
		await act(async () => {
			if (concurrentMove)
				f.client.setQueryData(f.listKey, {
					items: [{ ...page, position: 9 }, target, child],
				});
			response.reject(new Error("Network unavailable"));
			await pending;
		});
		expect(f.listed()).toEqual({ ...page, position: concurrentMove ? 9 : 1 });
		expect(f.onError).toHaveBeenLastCalledWith("Network unavailable");
		await act(async () =>
			f.result.current.move.commit(page.id, target.id, "inside"),
		);
		expect(f.request).toHaveBeenCalledTimes(2);
		expect(f.listed().parentPageId).toBe(target.id);
	});
}

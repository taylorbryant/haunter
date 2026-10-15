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
import { rq } from "@/client";
import { draftRegistry, type RegisteredDraft } from "@/client/draft-registry";
import { listTasks } from "@/features/tasks/contracts";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import {
	getPageNavigationQueryOptions,
	listPagesQueryOptions,
} from "../client/queries";
import { beginPageUpload, registerPageSaveFlusher } from "../client/save-state";
import {
	pageTrashDestination,
	pageTrashErrorMessage,
	usePageTrash,
} from "../client/use-page-trash";
import { listTrash } from "../contracts";
import type { PageMeta } from "../schemas";

const parent: PageMeta = {
	id: "00000000-0000-4000-8000-000000000001",
	workspaceId: "workspace",
	userId: "user",
	parentPageId: null,
	title: "Parent",
	icon: null,
	position: 1,
	deletedAt: null,
	createdAt: "2026-10-15T12:00:00.000Z",
	updatedAt: "2026-10-15T12:00:00.000Z",
};
const child = {
	...parent,
	id: "00000000-0000-4000-8000-000000000002",
	parentPageId: parent.id,
};
const sibling = { ...parent, id: "00000000-0000-4000-8000-000000000003" };
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
	const keys = [
		listPagesQueryOptions(parent.workspaceId).queryKey,
		getPageNavigationQueryOptions(parent.workspaceId).queryKey,
		rq(listTrash).key({ path: { workspaceId: parent.workspaceId } }),
		rq(listTasks).key({ path: { workspaceId: parent.workspaceId }, query: {} }),
	];
	client.setQueryData(keys[0], { items: [parent, child, sibling] });
	for (const key of keys.slice(1))
		client.setQueryData(key, { items: [], favorites: [], recents: [] });
	const fetchSpy = mock(
		async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
			new Response(null, { status: 204 }),
	);
	const hierarchyRequest = mock(async () =>
		Response.json({ items: [parent, child, sibling] }),
	);
	spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
				init?.method === "DELETE" ? fetchSpy(input, init) : hierarchyRequest(),
			{ preconnect: fetch.preconnect },
		),
	);
	const hook = renderHook(usePageTrash, {
		wrapper: ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		),
	});
	return { client, keys, fetchSpy, hierarchyRequest, ...hook };
}

const target = { workspaceId: parent.workspaceId, pageId: parent.id };

for (const cachedState of ["fresh", "invalidated"] as const) {
	test(`trashing refreshes the ${cachedState} hierarchy before flushing a newly moved child`, async () => {
		const { client, keys, result, fetchSpy, hierarchyRequest } = setup();
		client.setQueryDefaults(keys[0], { staleTime: Infinity });
		client.setQueryData(keys[0], {
			items: [parent, { ...child, parentPageId: null }, sibling],
		});
		if (cachedState === "invalidated")
			await client.invalidateQueries({
				queryKey: keys[0],
				exact: true,
				refetchType: "none",
			});
		const saveChild = mock(async () => false);
		disposals.push(registerPageSaveFlusher(child.id, saveChild));
		await act(async () => {
			await expect(result.current.moveToTrash(target)).rejects.toThrow(
				"Save your changes",
			);
		});
		expect(hierarchyRequest).toHaveBeenCalledTimes(1);
		expect(saveChild).toHaveBeenCalledTimes(1);
		expect(fetchSpy).not.toHaveBeenCalled();
		saveChild.mockResolvedValue(true);
		await act(async () => {
			expect(await result.current.moveToTrash(target)).toMatchObject({
				pageIds: [parent.id, child.id],
			});
		});
		expect(hierarchyRequest).toHaveBeenCalledTimes(2);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});
}

test("trashing replaces an in-flight hierarchy read that predates a collaborator's move", async () => {
	const { client, result, fetchSpy, hierarchyRequest } = setup();
	const oldRead = Promise.withResolvers<Response>();
	hierarchyRequest.mockImplementationOnce(() => oldRead.promise);
	const previousFetch = client
		.fetchQuery(listPagesQueryOptions(parent.workspaceId))
		.catch(() => undefined);
	const saveChild = mock(async () => false);
	disposals.push(registerPageSaveFlusher(child.id, saveChild));
	try {
		await act(async () => {
			await expect(result.current.moveToTrash(target)).rejects.toThrow(
				"Save your changes",
			);
		});
		expect(hierarchyRequest).toHaveBeenCalledTimes(2);
		expect(saveChild).toHaveBeenCalledTimes(1);
		expect(fetchSpy).not.toHaveBeenCalled();
	} finally {
		oldRead.resolve(Response.json({ items: [parent, sibling] }));
		await previousFetch;
	}
});

test("a hierarchy read failure blocks deletion even with cached pages and permits retry", async () => {
	const { result, fetchSpy, hierarchyRequest } = setup();
	hierarchyRequest.mockRejectedValueOnce(new Error("Network unavailable"));
	await act(async () => {
		await expect(result.current.moveToTrash(target)).rejects.toThrow();
	});
	expect(fetchSpy).not.toHaveBeenCalled();
	expect(result.current.isPending).toBe(false);
	await act(async () => {
		await result.current.moveToTrash(target);
	});
	expect(fetchSpy).toHaveBeenCalledTimes(1);
});

function retainedDraft(
	flushServer: RegisteredDraft["flushServer"],
	identity: Partial<RegisteredDraft["identity"]> = {},
): RegisteredDraft {
	return {
		identity: {
			key: "retained-child",
			userId: parent.userId,
			workspaceId: parent.workspaceId,
			resourceId: child.id,
			resourceType: "page",
			...identity,
		},
		getSnapshot: () => ({
			value: "Unsynced edits",
			serverValue: "Older text",
			serverVersion: "v1",
			status: "pending",
			dirty: true,
			locallySaved: true,
			error: null,
			validationError: null,
		}),
		subscribe: () => () => {},
		pause: () => {},
		resume: () => {},
		flushLocal: async () => {},
		flushServer,
	};
}

for (const failure of ["unsaved", "throws"] as const) {
	test(`retained child session failure (${failure}) blocks trash after its editor unmounts and permits retry`, async () => {
		const { result, fetchSpy } = setup();
		let saved = false;
		const flushServer = mock(async () => {
			if (!saved && failure === "throws") throw new Error("Save failed");
			return saved;
		});
		const unregisterEditor = registerPageSaveFlusher(child.id, flushServer);
		disposals.push(draftRegistry.register(retainedDraft(flushServer)));
		unregisterEditor();
		await act(async () => {
			await expect(result.current.moveToTrash(target)).rejects.toThrow(
				"Save your changes",
			);
		});
		expect(flushServer).toHaveBeenCalledTimes(1);
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(result.current.isPending).toBe(false);
		saved = true;
		await act(async () => {
			await result.current.moveToTrash(target);
		});
		expect(flushServer).toHaveBeenCalledTimes(2);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});
}

test("retained sessions wait for uploads and server acknowledgement, scoped to pages in the workspace subtree", async () => {
	const { result, fetchSpy } = setup();
	const uploaded = beginPageUpload(child.id);
	const acknowledged = Promise.withResolvers<boolean>();
	const saveChild = mock(() => acknowledged.promise);
	const saveOther = mock(async () => false);
	disposals.push(
		uploaded,
		draftRegistry.register(retainedDraft(saveChild)),
		draftRegistry.register(
			retainedDraft(saveOther, { resourceId: sibling.id }),
		),
		draftRegistry.register(retainedDraft(saveOther, { workspaceId: "other" })),
		draftRegistry.register(
			retainedDraft(saveOther, { resourceType: "canvas" }),
		),
	);
	let pending!: ReturnType<typeof result.current.moveToTrash>;
	await act(async () => {
		pending = result.current.moveToTrash(target);
	});
	expect(saveChild).not.toHaveBeenCalled();
	expect(fetchSpy).not.toHaveBeenCalled();
	await act(async () => uploaded());
	expect(saveChild).toHaveBeenCalledTimes(1);
	expect(fetchSpy).not.toHaveBeenCalled();
	expect(result.current.isPending).toBe(true);
	await act(async () => {
		acknowledged.resolve(true);
		await pending;
	});
	expect(saveOther).not.toHaveBeenCalled();
	expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test("trashing a parent waits for child uploads and all page saves, then refreshes shared caches", async () => {
	const { result, fetchSpy, client, keys } = setup();
	const finishUpload = beginPageUpload(child.id);
	disposals.push(finishUpload);
	const saveParent = mock(async () => true);
	const saveChild = mock(async () => true);
	const saveSibling = mock(async () => false);
	disposals.push(
		registerPageSaveFlusher(parent.id, saveParent),
		registerPageSaveFlusher(child.id, saveChild),
		registerPageSaveFlusher(sibling.id, saveSibling),
	);
	const removed = mock(() => false);
	let pending!: ReturnType<typeof result.current.moveToTrash>;
	await act(async () => {
		pending = result.current.moveToTrash({ ...target, onRemoved: removed });
	});
	expect(result.current.isPending).toBe(true);
	expect(saveParent).toHaveBeenCalledTimes(1);
	expect(saveChild).not.toHaveBeenCalled();
	expect(fetchSpy).not.toHaveBeenCalled();
	await act(async () => {
		expect(await result.current.moveToTrash(target)).toBeUndefined();
	});
	await act(async () => {
		finishUpload();
		await pending;
	});
	expect(saveChild).toHaveBeenCalledTimes(1);
	expect(saveSibling).not.toHaveBeenCalled();
	expect(fetchSpy).toHaveBeenCalledTimes(1);
	expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(parent.id);
	expect(removed).toHaveBeenCalledWith([parent.id, child.id]);
	for (const key of keys)
		expect(client.getQueryState(key)?.isInvalidated).toBe(true);
	expect(result.current.isPending).toBe(false);
});

for (const failure of ["unsaved", "throws"] as const) {
	test(`child save failure (${failure}) blocks deletion and permits retry`, async () => {
		const { result, fetchSpy } = setup();
		let saved = false;
		disposals.push(
			registerPageSaveFlusher(child.id, async () => {
				if (!saved && failure === "throws")
					throw new Error("Storage unavailable");
				return saved;
			}),
		);
		const removed = mock(() => false);
		await act(async () => {
			const message = await result.current
				.moveToTrash({ ...target, onRemoved: removed })
				.catch(pageTrashErrorMessage);
			expect(message).toBe(
				"Save your changes before moving this page to trash.",
			);
		});
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(removed).not.toHaveBeenCalled();
		expect(result.current.isPending).toBe(false);
		saved = true;
		await act(async () => {
			await result.current.moveToTrash({ ...target, onRemoved: removed });
		});
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(removed).toHaveBeenCalledTimes(1);
	});
}

test("embedded preparation can block removal and receives the entire removed subtree", async () => {
	const { result, fetchSpy } = setup();
	const beforeRemove = mock(async () => false);
	await act(async () => {
		await expect(
			result.current.moveToTrash({ ...target, beforeRemove }),
		).rejects.toThrow("Save your changes");
	});
	expect(fetchSpy).not.toHaveBeenCalled();
	beforeRemove.mockResolvedValue(true);
	const removed = mock(() => true);
	await act(async () => {
		expect(
			await result.current.moveToTrash({
				...target,
				beforeRemove,
				onRemoved: removed,
			}),
		).toEqual({ pageIds: [parent.id, child.id], handled: true });
	});
	expect(beforeRemove).toHaveBeenCalledTimes(2);
	expect(removed).toHaveBeenCalledWith([parent.id, child.id]);
});

test("a failed delete leaves navigation alone and can be retried", async () => {
	const { result, fetchSpy, client, keys } = setup();
	fetchSpy.mockRejectedValueOnce(new Error("Network unavailable"));
	const removed = mock(() => false);
	await act(async () => {
		await expect(
			result.current.moveToTrash({ ...target, onRemoved: removed }),
		).rejects.toThrow();
	});
	expect(removed).not.toHaveBeenCalled();
	expect(client.getQueryState(keys[0])?.isInvalidated).toBe(false);
	await act(async () => {
		await result.current.moveToTrash({ ...target, onRemoved: removed });
	});
	expect(removed).toHaveBeenCalledTimes(1);
});

test("post-trash navigation follows the current route and only leaves the removed subtree", () => {
	const ids = [parent.id, child.id];
	expect(
		pageTrashDestination(`/w/workspace/p/${child.id}`, "workspace", ids),
	).toBe("/w/workspace/home");
	expect(
		pageTrashDestination(`/w/workspace/p/${sibling.id}`, "workspace", ids),
	).toBeNull();
	expect(
		pageTrashDestination(`/w/other/p/${child.id}`, "workspace", ids),
	).toBeNull();
	expect(
		pageTrashDestination("/w/workspace/tasks", "workspace", ids),
	).toBeNull();
});

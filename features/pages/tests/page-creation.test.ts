import { expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
	getEditorPageQueryOptions,
	getPageNavigationQueryOptions,
	listPagesQueryOptions,
	reconcileCreatedPage,
} from "../client/queries";
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
const created = {
	...parent,
	id: "00000000-0000-4000-8000-000000000002",
	parentPageId: parent.id,
	title: "New child",
};

test("a new page can render immediately while navigation and parent refreshes are still pending", async () => {
	const client = new QueryClient();
	const listKey = listPagesQueryOptions("workspace").queryKey;
	const parentKey = getEditorPageQueryOptions(parent.id).queryKey;
	const navigationKey = getPageNavigationQueryOptions("workspace").queryKey;
	client.setQueryData(listKey, { items: [parent] });
	client.setQueryData(parentKey, parent);
	client.setQueryData(navigationKey, { favorites: [], recents: [] });
	const refreshed = Promise.withResolvers<{ items: PageMeta[] }>();
	const observer = new QueryObserver(client, {
		queryKey: listKey,
		staleTime: Infinity,
		queryFn: () => refreshed.promise,
	});
	const unsubscribe = observer.subscribe(() => {});
	const parentInvalidated = Promise.withResolvers<void>();
	const stopWatching = client.getQueryCache().subscribe(() => {
		if (client.getQueryState(parentKey)?.isInvalidated)
			parentInvalidated.resolve();
	});
	try {
		// Callers continue synchronously to navigate; the list request is held open.
		expect(reconcileCreatedPage(client, created)).toBeUndefined();
		expect(client.getQueryState(listKey)?.fetchStatus).toBe("fetching");
		let metadataRequests = 0;
		const editor = new QueryObserver(client, {
			...getEditorPageQueryOptions(created.id),
			queryFn: async () => {
				metadataRequests++;
				return created;
			},
		});
		const stopEditor = editor.subscribe(() => {});
		expect(editor.getCurrentResult().status).toBe("success");
		expect(editor.getCurrentResult().data?.title).toBe("New child");
		expect(metadataRequests).toBe(0);
		expect(
			client
				.getQueryData<{ items: PageMeta[] }>(listKey)
				?.items.map((page) => page.id),
		).toEqual([parent.id, created.id]);
		await parentInvalidated.promise;
		expect(client.getQueryState(parentKey)?.isInvalidated).toBe(true);
		expect(client.getQueryState(navigationKey)?.isInvalidated).toBe(true);
		stopEditor();
	} finally {
		refreshed.resolve({ items: [parent, created] });
		unsubscribe();
		stopWatching();
		client.clear();
	}
});

test("creation from an empty cache warms metadata without fabricating a complete page list or body", () => {
	const client = new QueryClient();
	try {
		reconcileCreatedPage(client, created);
		expect(
			client.getQueryData(getEditorPageQueryOptions(created.id).queryKey),
		).toEqual(created);
		expect(
			client.getQueryData(listPagesQueryOptions("workspace").queryKey),
		).toBeUndefined();
	} finally {
		client.clear();
	}
});

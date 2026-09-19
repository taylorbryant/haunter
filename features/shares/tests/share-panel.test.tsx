import { afterAll, afterEach, beforeAll, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { rq } from "@/client";
import { registerPageSaveFlusher } from "@/features/pages/client/save-state";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import { getPageShare } from "../contracts";
import type { PageShare } from "../schemas";

const pageId = "00000000-0000-4000-8000-000000000001";
const otherPageId = "00000000-0000-4000-8000-000000000002";
const publishedShare: PageShare = {
	id: "00000000-0000-4000-8000-000000000003",
	pageId,
	workspaceId: "workspace_1",
	token: "public-token",
	createdBy: "user_1",
	createdAt: "2026-09-18T00:00:00.000Z",
};

let SharePanel: typeof import("../components/share-button").SharePanel;
let queryClient: QueryClient;
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
let unregisterFlusher: (() => void) | undefined;

beforeAll(async () => {
	installTestDom();
	SharePanel = (await import("../components/share-button")).SharePanel;
});
afterEach(() => {
	cleanup();
	queryClient.clear();
	fetchSpy.mockRestore();
	unregisterFlusher?.();
	unregisterFlusher = undefined;
});
afterAll(uninstallTestDom);

function setup() {
	queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: Infinity } },
	});
	const otherKey = rq(getPageShare).key({ path: { pageId: otherPageId } });
	queryClient.setQueryData(otherKey, { share: null });
	let share: PageShare | null = null;
	const requests: string[] = [];
	let refresh: Promise<Response> | undefined;
	fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				expect(String(input)).toEndWith(`/api/pages/${pageId}/share`);
				const method = init?.method ?? "GET";
				requests.push(method);
				if (method === "POST") {
					share = publishedShare;
					return Response.json(share);
				}
				if (method === "DELETE") {
					share = null;
					return new Response(null, { status: 204 });
				}
				return refresh ?? Response.json({ share });
			},
			{ preconnect: fetch.preconnect },
		),
	);
	const panel = (active: boolean) => (
		<QueryClientProvider client={queryClient}>
			<SharePanel pageId={pageId} active={active} />
		</QueryClientProvider>
	);
	return {
		panel,
		requests,
		otherKey,
		deferRefresh(response?: Promise<Response>) {
			refresh = response;
		},
	};
}

test("publishes and revokes with scoped refreshes after pending saves finish", async () => {
	const { panel, requests, otherKey, deferRefresh } = setup();
	const user = userEvent.setup({ document });
	const view = render(panel(false));
	await act(async () => {});
	expect(requests).toEqual([]);
	view.rerender(panel(true));
	const publish = await view.findByRole("button", { name: "Publish" });
	const save = Promise.withResolvers<boolean>();
	unregisterFlusher = registerPageSaveFlusher(pageId, () => save.promise);
	await user.click(publish);
	expect(requests).toEqual(["GET"]);
	const refresh = Promise.withResolvers<Response>();
	deferRefresh(refresh.promise);
	await act(async () => save.resolve(true));
	await waitFor(() => expect(requests).toEqual(["GET", "POST", "GET"]));
	expect(
		view.getByRole("button", { name: "Publishing…" }).hasAttribute("disabled"),
	).toBe(true);
	await act(async () =>
		refresh.resolve(Response.json({ share: publishedShare })),
	);
	await view.findByText("Shared to the web");
	expect(queryClient.getQueryState(otherKey)?.isInvalidated).toBe(false);

	deferRefresh();
	await user.click(view.getByRole("button", { name: "Revoke link" }));
	const confirmation = await view.findByRole("dialog");
	await user.click(
		within(confirmation).getByRole("button", { name: "Revoke link" }),
	);
	await view.findByRole("button", { name: "Publish" });
	expect(requests).toEqual(["GET", "POST", "GET", "DELETE", "GET"]);
	expect(queryClient.getQueryState(otherKey)?.isInvalidated).toBe(false);
	expect(
		queryClient.getQueryData<{ share: PageShare | null }>(
			rq(getPageShare).key({ path: { pageId } }),
		),
	).toEqual({ share: null });
});

test("does not publish when the page cannot be saved", async () => {
	const { panel, requests } = setup();
	const user = userEvent.setup({ document });
	unregisterFlusher = registerPageSaveFlusher(pageId, async () => false);
	const view = render(panel(true));
	await user.click(await view.findByRole("button", { name: "Publish" }));
	expect(
		await view.findByText("Save this page before sharing."),
	).not.toBeNull();
	expect(requests).toEqual(["GET"]);
});

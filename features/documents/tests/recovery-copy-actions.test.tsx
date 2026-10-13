import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { type ReactNode } from "react";
import { rq } from "@/client";
import { WorkspaceNavigationContext } from "@/client/workspace-navigation";
import { getPageNavigation, listPages } from "@/features/pages/contracts";
import { deferred } from "@/features/collab/tests/helpers";
import { RecoveryCopyActions } from "../components/recovery-copy-actions";
import {
	useRecoveryCopyActions,
	type RecoverySource,
} from "../client/use-recovery-copy-actions";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";

let queryClient: QueryClient;
const push = mock();
const router = {
	bfcacheId: "recovery-test",
	push,
	replace: mock(),
	prefetch: mock(),
	back: mock(),
	forward: mock(),
	refresh: mock(),
};
const cleanups: Array<() => void> = [];
beforeEach(() => {
	installTestDom();
	push.mockClear();
	queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
});
afterEach(async () => {
	cleanup();
	queryClient.clear();
	for (const clean of cleanups.splice(0).reverse()) clean();
	await uninstallTestDom();
});

function Wrapper({ children }: { children: ReactNode }) {
	return (
		<AppRouterContext.Provider value={router}>
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		</AppRouterContext.Provider>
	);
}

// The controller stays mounted while responsive layouts replace the action subtree.
function RecoveryActionsHarness({
	workspaceId,
	generation,
	source,
	mobile = false,
}: {
	workspaceId: string;
	generation: number;
	source: RecoverySource;
	mobile?: boolean;
}) {
	const actions = useRecoveryCopyActions(workspaceId, source);
	const buttons = (
		<RecoveryCopyActions generation={generation} actions={actions} />
	);
	return mobile ? <section>{buttons}</section> : <div>{buttons}</div>;
}

function mockImport(handler: (request: Request) => Promise<Response>) {
	const spy = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			(input: RequestInfo | URL, init?: RequestInit) =>
				handler(
					new Request(new URL(String(input), window.location.origin), init),
				),
			{ preconnect: fetch.preconnect },
		),
	);
	cleanups.push(() => spy.mockRestore());
	return spy;
}

const recoveredPageId = "a8c4e8e4-d397-4d73-83bc-cd0a252b3c18";
const recovered = () =>
	Response.json({
		pages: [{ id: recoveredPageId, title: "Recovered page" }],
		canvasIds: [],
	});
test("opens the selected browser copy as a new page, refreshes navigation, and preserves the source copy", async () => {
	const read = deferred<string>();
	const download = mock((_generation?: number) => read.promise);

	const requests: Request[] = [];
	const fetchSpy = mockImport(async (request) => {
		requests.push(request);
		return recovered();
	});
	const listKey = rq(listPages).key({ path: { workspaceId: "workspace" } });
	const navigationKey = rq(getPageNavigation).key({
		path: { workspaceId: "workspace" },
	});
	queryClient.setQueryData(listKey, { items: [] });
	queryClient.setQueryData(navigationKey, { favorites: [], recents: [] });
	const user = userEvent.setup({ document });
	const view = render(
		<RecoveryActionsHarness
			workspaceId="workspace"
			generation={0}
			source={{ recoveryDownload: download }}
		/>,
		{ wrapper: Wrapper },
	);
	await user.dblClick(view.getByRole("button", { name: "Open as a new page" }));
	expect(download.mock.calls).toEqual([[0]]);
	expect(
		view.getByRole("button", { name: "Opening…" }).hasAttribute("disabled"),
	).toBe(true);
	expect(fetchSpy).not.toHaveBeenCalled();
	await act(async () => read.resolve("selected recovery JSON"));
	await waitFor(() =>
		expect(push).toHaveBeenCalledWith(`/w/workspace/p/${recoveredPageId}`),
	);
	expect(requests).toHaveLength(1);
	expect(new URL(requests[0].url).pathname).toBe("/api/document-recoveries");
	expect(requests[0].method).toBe("POST");
	expect(await requests[0].json()).toEqual({
		workspaceId: "workspace",
		filename: "haunter-previous-copy.json",
		file: "selected recovery JSON",
	});
	expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
	expect(queryClient.getQueryState(navigationKey)?.isInvalidated).toBe(true);
	// A blocked navigation can be retried without creating another page.
	await user.click(view.getByRole("button", { name: "Open as a new page" }));
	expect(fetchSpy).toHaveBeenCalledTimes(1);
	expect(push).toHaveBeenCalledTimes(2);
});

test("a lost import response retries the same copy and idempotency key after changing selection", async () => {
	const requests: Request[] = [];
	mockImport(async (request) => {
		requests.push(request);
		if (requests.length === 1) throw new TypeError("Connection lost");
		return recovered();
	});
	const download = mock(async (generation: number) => `copy ${generation}`);
	const user = userEvent.setup({ document });
	const view = render(
		<RecoveryActionsHarness
			workspaceId="workspace"
			generation={0}
			source={{
				recoveryDownload: download,
			}}
		/>,
		{ wrapper: Wrapper },
	);
	await user.click(view.getByRole("button", { name: "Open as a new page" }));
	expect((await view.findByRole("alert")).textContent).toContain(
		"still saved in this browser",
	);
	expect(push).not.toHaveBeenCalled();
	view.rerender(
		<RecoveryActionsHarness
			workspaceId="workspace"
			generation={2}
			source={{ recoveryDownload: download }}
		/>,
	);
	view.rerender(
		<RecoveryActionsHarness
			workspaceId="workspace"
			generation={0}
			source={{ recoveryDownload: download }}
		/>,
	);
	await user.click(view.getByRole("button", { name: "Open as a new page" }));
	await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
	expect(download).toHaveBeenCalledTimes(1);
	expect(requests).toHaveLength(2);
	const key = requests[0].headers.get("idempotency-key");
	expect(key).toBeTruthy();
	expect(requests[1].headers.get("idempotency-key")).toBe(key);
	expect(await requests[1].text()).toBe(await requests[0].text());
});

test("a failed browser read leaves download available and can be retried in the embedded app", async () => {
	const download = mock(async (): Promise<string> => {
		throw new Error("Storage unavailable");
	});
	const fetchSpy = mockImport(async () => recovered());
	const navigate = mock(async () => {});
	const user = userEvent.setup({ document });
	const view = render(
		<WorkspaceNavigationContext.Provider
			value={{ pathname: "/w/workspace/p/source-page", navigate }}
		>
			<RecoveryActionsHarness
				workspaceId="workspace"
				generation={0}
				source={{
					recoveryDownload: download,
				}}
			/>
		</WorkspaceNavigationContext.Provider>,
		{ wrapper: Wrapper },
	);
	await user.click(view.getByRole("button", { name: "Open as a new page" }));
	expect((await view.findByRole("alert")).textContent).toBe(
		"The recovery copy could not be opened. Your copy is still saved in this browser.",
	);
	expect(fetchSpy).not.toHaveBeenCalled();
	expect(
		view
			.getByRole("button", { name: "Download copy" })
			.hasAttribute("disabled"),
	).toBe(false);
	download.mockImplementation(async () => "recovered JSON");
	await user.click(view.getByRole("button", { name: "Open as a new page" }));
	await waitFor(() =>
		expect(navigate).toHaveBeenCalledWith(`/w/workspace/p/${recoveredPageId}`),
	);
	expect(push).not.toHaveBeenCalled();
});

test("download progress and failures describe the selected copy across layout changes", async () => {
	const read = deferred<string>();
	const download = mock((_generation: number) => read.promise);
	const source = { recoveryDownload: download };
	const fetchSpy = mockImport(async () => recovered());
	const user = userEvent.setup({ document });
	const view = render(
		<RecoveryActionsHarness
			workspaceId="workspace"
			generation={0}
			source={source}
		/>,
		{ wrapper: Wrapper },
	);
	await user.dblClick(view.getByRole("button", { name: "Download copy" }));
	expect(
		view.getByRole("button", { name: "Downloading…" }).hasAttribute("disabled"),
	).toBe(true);
	const open = view.getByRole("button", { name: "Open as a new page" });
	expect(open.hasAttribute("disabled")).toBe(true);
	await user.click(open);
	expect(download.mock.calls).toEqual([[0]]);
	// Switching copies must not announce that a different copy is downloading.
	view.rerender(
		<RecoveryActionsHarness
			workspaceId="workspace"
			generation={2}
			source={source}
			mobile
		/>,
	);
	expect(
		view.queryByRole("button", { name: /Opening|Downloading/ }),
	).toBeNull();
	expect(
		view
			.getByRole("button", { name: "Download copy" })
			.hasAttribute("disabled"),
	).toBe(true);
	view.rerender(
		<RecoveryActionsHarness
			workspaceId="workspace"
			generation={0}
			source={source}
		/>,
	);
	expect(
		view.getByRole("button", { name: "Downloading…" }).hasAttribute("disabled"),
	).toBe(true);
	await act(async () => read.reject(new Error("Storage unavailable")));
	expect((await view.findByRole("alert")).textContent).toBe(
		"The recovery copy could not be downloaded. Your copy is still saved in this browser.",
	);
	for (const name of ["Open as a new page", "Download copy"])
		expect(view.getByRole("button", { name }).hasAttribute("disabled")).toBe(
			false,
		);
	expect(fetchSpy).not.toHaveBeenCalled();
	expect(push).not.toHaveBeenCalled();
	view.rerender(
		<RecoveryActionsHarness
			workspaceId="workspace"
			generation={2}
			source={source}
		/>,
	);
	expect(view.queryByRole("alert")).toBeNull();
});

test("a lost response retains its error, payload, and retry key across responsive layouts", async () => {
	const requests: Request[] = [];
	mockImport(async (request) => {
		requests.push(request);
		if (requests.length === 1)
			throw new TypeError("Response lost after commit");
		return recovered();
	});
	const download = mock(async () => "original copy");
	const source = { recoveryDownload: download };
	const user = userEvent.setup({ document });
	const view = render(
		<RecoveryActionsHarness
			workspaceId="workspace"
			generation={0}
			source={source}
			mobile
		/>,
		{ wrapper: Wrapper },
	);
	await user.click(view.getByRole("button", { name: "Open as a new page" }));
	await view.findByRole("alert");
	// Another old tab can update the archive while the outcome is unknown.
	download.mockImplementation(async () => "later edits");
	view.rerender(
		<RecoveryActionsHarness
			workspaceId="workspace"
			generation={0}
			source={source}
		/>,
	);
	expect(view.getByRole("alert").textContent).toContain(
		"still saved in this browser",
	);
	await user.click(view.getByRole("button", { name: "Open as a new page" }));
	await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
	expect(requests).toHaveLength(2);
	expect(download).toHaveBeenCalledTimes(1);
	expect(requests[0].headers.get("idempotency-key")).toBeTruthy();
	expect(requests[1].headers.get("idempotency-key")).toBe(
		requests[0].headers.get("idempotency-key"),
	);
	expect(await requests[1].text()).toBe(await requests[0].text());
});

test("layout changes retain an in-flight operation and its completed result", async () => {
	const read = deferred<string>();
	const download = mock(() => read.promise);
	const response = deferred<Response>();
	const fetchSpy = mockImport(() => response.promise);
	const source = { recoveryDownload: download };
	const user = userEvent.setup({ document });
	const view = render(
		<RecoveryActionsHarness
			workspaceId="workspace"
			generation={0}
			source={source}
			mobile
		/>,
		{ wrapper: Wrapper },
	);
	await user.click(view.getByRole("button", { name: "Open as a new page" }));
	view.rerender(
		<RecoveryActionsHarness
			workspaceId="workspace"
			generation={0}
			source={source}
		/>,
	);
	expect(
		view.getByRole("button", { name: "Opening…" }).hasAttribute("disabled"),
	).toBe(true);
	await user.click(view.getByRole("button", { name: "Opening…" }));
	expect(download).toHaveBeenCalledTimes(1);
	await act(async () => read.resolve("original copy"));
	await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
	view.rerender(
		<RecoveryActionsHarness
			workspaceId="workspace"
			generation={0}
			source={source}
			mobile
		/>,
	);
	expect(
		view.getByRole("button", { name: "Opening…" }).hasAttribute("disabled"),
	).toBe(true);
	await act(async () => response.resolve(recovered()));
	await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
	// If draft protection blocks navigation, the created page survives another layout change.
	view.rerender(
		<RecoveryActionsHarness
			workspaceId="workspace"
			generation={0}
			source={source}
		/>,
	);
	await user.click(view.getByRole("button", { name: "Open as a new page" }));
	await waitFor(() => expect(push).toHaveBeenCalledTimes(2));
	expect(fetchSpy).toHaveBeenCalledTimes(1);
});

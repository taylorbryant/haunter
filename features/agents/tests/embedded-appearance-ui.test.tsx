import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import {
	useEmbeddedAppearance,
	waitForEmbeddedAppearanceWrites,
} from "../client/embedded-appearance";
import type { EmbeddedAppearance } from "../schemas";

beforeEach(installTestDom);
const cleanups: (() => void)[] = [];
afterEach(async () => {
	cleanup();
	for (const clean of cleanups.splice(0).reverse()) clean();
	await uninstallTestDom();
});

function openPanel() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	cleanups.push(() => client.clear());
	return {
		client,
		...renderHook(useEmbeddedAppearance, {
			wrapper: ({ children }: { children: ReactNode }) => (
				<QueryClientProvider client={client}>{children}</QueryClientProvider>
			),
		}),
	};
}

test("a fresh panel restores the saved theme without browser storage and can restore Follow host", async () => {
	let saved: EmbeddedAppearance = { theme: "host" };
	const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (_url: RequestInfo | URL, init?: RequestInit) => {
				if (init?.method === "PUT") saved = JSON.parse(String(init.body));
				return Response.json(saved);
			},
			{ preconnect: fetch.preconnect },
		),
	);
	cleanups.push(() => fetchMock.mockRestore());
	const storage = spyOn(Storage.prototype, "setItem").mockImplementation(() => {
		throw new Error("Storage is unavailable");
	});
	cleanups.push(() => storage.mockRestore());
	const first = openPanel();
	await waitFor(() => expect(first.result.current.loading).toBeFalse());
	act(() => first.result.current.change("dracula"));
	await waitFor(() => expect(saved.theme).toBe("dracula"));
	await waitFor(() => expect(first.result.current.saving).toBeFalse());
	first.unmount();
	first.client.clear();
	localStorage.clear();
	const reopened = openPanel();
	await waitFor(() => expect(reopened.result.current.theme).toBe("dracula"));
	act(() => reopened.result.current.change("host"));
	await waitFor(() => expect(saved.theme).toBe("host"));
	await waitFor(() => expect(reopened.result.current.saving).toBeFalse());
	const again = openPanel();
	await waitFor(() => expect(again.result.current.loading).toBeFalse());
	expect(again.result.current.theme).toBe("host");
	expect(storage).not.toHaveBeenCalled();
});

test("failed saves stay visible and retry; closing waits for the pending save", async () => {
	let fail = true;
	let finish: (() => void) | undefined;
	const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (_url: RequestInfo | URL, init?: RequestInit) => {
				if (init?.method !== "PUT") return Response.json({ theme: "host" });
				if (fail)
					return Response.json({ message: "Unavailable" }, { status: 503 });
				await new Promise<void>((resolve) => {
					finish = resolve;
				});
				return Response.json(JSON.parse(String(init.body)));
			},
			{ preconnect: fetch.preconnect },
		),
	);
	cleanups.push(() => fetchMock.mockRestore());
	const panel = openPanel();
	await waitFor(() => expect(panel.result.current.loading).toBeFalse());
	act(() => panel.result.current.change("dracula"));
	await waitFor(() =>
		expect(panel.result.current.error).toBe("Couldn’t save your theme."),
	);
	expect(panel.result.current.theme).toBe("dracula");
	fail = false;
	act(() => panel.result.current.retry());
	await waitFor(() => expect(finish).toBeDefined());
	let closed = false;
	const closing = waitForEmbeddedAppearanceWrites(panel.client).then(
		(saved) => {
			closed = true;
			return saved;
		},
	);
	expect(closed).toBeFalse();
	await act(async () => finish?.());
	expect(await closing).toBeTrue();
	await waitFor(() => expect(panel.result.current.error).toBeNull());
});

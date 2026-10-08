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
import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType } from "react";
import { CommandRegistryProvider } from "@/components/command-palette/registry";
import { WorkspaceNavigationContext } from "@/client/workspace-navigation";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import type { SearchResult } from "../schemas";

let navigated = "";
mock.module("next/navigation", () => ({
	usePathname: () => "/w/a/home",
	useSearchParams: () => new URLSearchParams(),
	useRouter: () => ({
		push: (path: string) => {
			navigated = path;
		},
		prefetch() {},
	}),
}));

let SearchDialog: ComponentType<{
	open: boolean;
	onOpenChange(open: boolean): void;
}>;
const clients: QueryClient[] = [];
beforeAll(async () => {
	installTestDom();
	({ SearchCommandDialog: SearchDialog } = await import(
		"@/components/search-command-dialog"
	));
});
afterEach(() => {
	cleanup();
	clients.splice(0).forEach((client) => client.clear());
	mock.restore();
});
afterAll(uninstallTestDom);

const row = (kind: SearchResult["kind"], title: string): SearchResult => ({
	kind,
	id: crypto.randomUUID(),
	workspaceId: "a",
	title,
	snippet: "Launch plan",
	icon: null,
	pageId: null,
	pageTitle: null,
	shapeId: null,
	completed: kind === "task" ? false : null,
	updatedAt: "2026-10-01",
	path: `/w/a/${kind === "canvas" ? "c" : "p"}/target`,
});

function wrapper(client: QueryClient, workspaceId = "a") {
	return (
		<QueryClientProvider client={client}>
			<WorkspaceNavigationContext.Provider
				value={{
					pathname: `/w/${workspaceId}/home`,
					navigate: async (path) => {
						navigated = path;
					},
				}}
			>
				<CommandRegistryProvider>
					<SearchDialog open onOpenChange={() => {}} />
				</CommandRegistryProvider>
			</WorkspaceNavigationContext.Provider>
		</QueryClientProvider>
	);
}
function client() {
	const result = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	clients.push(result);
	return result;
}

test("search menu uses HTTP, filters resource types, loads more, and navigates inside embedded Haunter", async () => {
	const drawing = row("canvas", "Launch diagram");
	const task = row("task", "Launch checklist");
	const requests: URL[] = [];
	let failNextPage = true;
	spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (input: RequestInfo | URL) => {
				const url = new URL(String(input), "http://localhost:3000");
				requests.push(url);
				if (url.pathname.endsWith("page-navigation"))
					return Response.json({ favorites: [], recents: [] });
				const second = url.searchParams.has("cursor");
				if (second && failNextPage) {
					failNextPage = false;
					return Response.json(
						{ code: "UNAVAILABLE", message: "Try again" },
						{ status: 503 },
					);
				}
				return Response.json({
					items:
						url.searchParams.get("kind") === "canvas"
							? [drawing]
							: second
								? [task]
								: [drawing],
					nextCursor:
						second || url.searchParams.get("kind") === "canvas"
							? null
							: "next-page",
				});
			},
			{ preconnect: fetch.preconnect },
		),
	);
	const view = render(wrapper(client()));
	const user = userEvent.setup({ document });
	await user.type(view.getByRole("combobox"), "launch");
	await waitFor(() => expect(view.getByText("Launch diagram")).toBeTruthy());
	await user.click(view.getByRole("option", { name: "Load more results" }));
	await waitFor(() =>
		expect(view.getByRole("alert").textContent).toContain(
			"Could not load more",
		),
	);
	expect(view.getByText("Launch diagram")).toBeTruthy();
	await user.click(view.getByRole("option", { name: "Load more results" }));
	await waitFor(() => expect(view.getByText("Launch checklist")).toBeTruthy());
	expect(
		requests.some((url) => url.searchParams.get("cursor") === "next-page"),
	).toBeTrue();
	await user.click(view.getByRole("button", { name: "Canvases" }));
	await waitFor(() =>
		expect(
			requests.some((url) => url.searchParams.get("kind") === "canvas"),
		).toBeTrue(),
	);
	await waitFor(() => expect(view.queryByText("Launch checklist")).toBeNull());
	await user.click(view.getByRole("option", { name: /Launch diagram/ }));
	expect(navigated).toBe(drawing.path);
});

test("search errors are retryable and changing workspace never displays the previous workspace results", async () => {
	const drawing = row("canvas", "Private launch diagram");
	let fail = true;
	spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (input: RequestInfo | URL) => {
				const url = new URL(String(input), "http://localhost:3000");
				if (url.pathname.endsWith("page-navigation"))
					return Response.json({ favorites: [], recents: [] });
				if (fail)
					return Response.json(
						{ code: "UNAVAILABLE", message: "Try again" },
						{ status: 503 },
					);
				return Response.json({
					items: url.pathname.startsWith("/api/workspaces/a/") ? [drawing] : [],
					nextCursor: null,
				});
			},
			{ preconnect: fetch.preconnect },
		),
	);
	const cache = client();
	const view = render(wrapper(cache));
	const user = userEvent.setup({ document });
	await user.type(view.getByRole("combobox"), "launch");
	await waitFor(() =>
		expect(view.getByRole("alert").textContent).toContain("Search could not"),
	);
	fail = false;
	await user.click(view.getByRole("button", { name: "Try again" }));
	await waitFor(() => expect(view.getByText(drawing.title)).toBeTruthy());
	view.rerender(wrapper(cache, "b"));
	expect(view.queryByText(drawing.title)).toBeNull();
	await waitFor(() => expect(view.getByText("No results found.")).toBeTruthy());
});

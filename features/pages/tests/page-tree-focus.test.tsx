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
import {
	act,
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceNavigationContext } from "@/client/workspace-navigation";
import { CommandRegistryProvider } from "@/components/command-palette/registry";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import {
	getPageNavigationQueryOptions,
	listPagesQueryOptions,
} from "../client/queries";
import type { PageMeta } from "../schemas";

const page: PageMeta = {
	id: "00000000-0000-4000-8000-000000000001",
	userId: "tester",
	workspaceId: "a",
	parentPageId: null,
	title: "Test page",
	icon: "👻",
	position: 1,
	deletedAt: null,
	createdAt: "2026-10-12T12:00:00.000Z",
	updatedAt: "2026-10-12T12:00:00.000Z",
};
const child: PageMeta = {
	...page,
	id: "00000000-0000-4000-8000-000000000002",
	parentPageId: page.id,
	title: "Child page",
};
const sibling: PageMeta = {
	...page,
	id: "00000000-0000-4000-8000-000000000003",
	title: "Sibling page",
	position: 2,
};
let workspaceRole = "owner";
mock.module("next/navigation", () => ({
	usePathname: () => `/w/a/p/${page.id}`,
	useSearchParams: () => new URLSearchParams(),
	useRouter: () => ({ push() {}, prefetch() {} }),
}));
mock.module("@/components/app-session-provider", () => ({
	useAppSession: () => ({ workspaceRole, activeWorkspaceId: "a" }),
}));
mock.module("@/features/pages/client/preload-editor", () => ({
	preloadHaunterEditor: async () => {},
}));

let PageTree: typeof import("../components/page-tree").PageTree;
let Sidebar: typeof import("@/components/ui/sidebar").Sidebar;
let SidebarProvider: typeof import("@/components/ui/sidebar").SidebarProvider;
let SidebarTrigger: typeof import("@/components/ui/sidebar").SidebarTrigger;
const clients: QueryClient[] = [];
let finishClosing: () => void;
let closingFinished: Promise<void>;
let originalGetAnimations: PropertyDescriptor | undefined;
beforeAll(async () => {
	installTestDom();
	originalGetAnimations = Object.getOwnPropertyDescriptor(
		HTMLElement.prototype,
		"getAnimations",
	);
	// Happy DOM has no CSS animations. Hold the action menu's exit animation
	// until the new dialog has focused, reproducing the browser's focus handoff.
	Object.defineProperty(HTMLElement.prototype, "getAnimations", {
		configurable: true,
		value(this: HTMLElement) {
			return this.matches(
				'[data-closed][data-slot="dropdown-menu-content"], [data-closed][data-slot="drawer-popup"]',
			)
				? [{ finished: closingFinished }]
				: [];
		},
	});
	({ PageTree } = await import("../components/page-tree"));
	({ Sidebar, SidebarProvider, SidebarTrigger } = await import(
		"@/components/ui/sidebar"
	));
});
afterEach(() => {
	finishClosing?.();
	cleanup();
	clients.splice(0).forEach((client) => client.clear());
	mock.restore();
	workspaceRole = "owner";
});
afterAll(async () => {
	if (originalGetAnimations)
		Object.defineProperty(
			HTMLElement.prototype,
			"getAnimations",
			originalGetAnimations,
		);
	else Reflect.deleteProperty(HTMLElement.prototype, "getAnimations");
	await uninstallTestDom();
});

function setup(
	width: number,
	pages = [page],
	respond?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) {
	window.innerWidth = width;
	localStorage.removeItem("haunter.tree.a");
	closingFinished = new Promise<void>((resolve) => {
		finishClosing = resolve;
	});
	spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				if (respond) return respond(input, init);
				// Keep the real emoji picker; supply its data without an external request.
				return Response.json(
					String(input).endsWith("messages.json")
						? { groups: [], subgroups: [], skinTones: [] }
						: [],
				);
			},
			{ preconnect: fetch.preconnect },
		),
	);
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
		},
	});
	clients.push(client);
	client.setQueryData(listPagesQueryOptions("a").queryKey, { items: pages });
	client.setQueryData(getPageNavigationQueryOptions("a").queryKey, {
		favorites: [],
		recents: [],
	});
	return render(
		<QueryClientProvider client={client}>
			<WorkspaceNavigationContext.Provider
				value={{ pathname: `/w/a/p/${page.id}`, navigate: async () => {} }}
			>
				<CommandRegistryProvider>
					<SidebarProvider>
						<SidebarTrigger />
						<Sidebar>
							<PageTree workspaceId="a" allowImports={false} />
						</Sidebar>
					</SidebarProvider>
				</CommandRegistryProvider>
			</WorkspaceNavigationContext.Provider>
		</QueryClientProvider>,
	);
}

for (const width of [1024, 390]) {
	for (const action of ["Move to trash", "Change icon"] as const) {
		test(`${action} keeps Tab inside the dialog and returns focus on close (${width}px)`, async () => {
			const view = setup(width);
			const user = userEvent.setup({ document });
			if (width < 768)
				await user.click(view.getByRole("button", { name: "Toggle Sidebar" }));
			const launcher = await view.findByRole("button", {
				name: "Page actions",
			});
			await user.click(launcher);
			await user.click(
				await view.findByRole(width < 768 ? "button" : "menuitem", {
					name: action,
				}),
			);
			const dialog = await view.findByRole("dialog", {
				name: action === "Change icon" ? "Change page icon" : "Move to trash?",
			});
			if (action === "Change icon")
				await within(dialog).findByPlaceholderText("Search emoji...");
			await waitFor(() =>
				expect(dialog.contains(document.activeElement)).toBe(true),
			);
			await act(async () => finishClosing());
			await waitFor(() =>
				expect(
					document.querySelector(
						'[data-closed][data-slot="dropdown-menu-content"], [data-closed][data-slot="drawer-popup"]',
					),
				).toBeNull(),
			);
			expect(dialog.contains(document.activeElement)).toBe(true);
			for (let index = 0; index < 5; index++) {
				await user.tab();
				expect(dialog.contains(document.activeElement)).toBe(true);
			}
			await user.tab({ shift: true });
			expect(dialog.contains(document.activeElement)).toBe(true);
			await user.keyboard("{Escape}");
			await waitFor(() =>
				expect(document.activeElement === launcher).toBe(true),
			);
			// The next menu opening should still return focus normally on dismissal.
			await user.click(launcher);
			await view.findByRole(width < 768 ? "dialog" : "menu", {
				name: width < 768 ? /Test page/ : "Page actions",
			});
			await user.keyboard("{Escape}");
			await waitFor(() =>
				expect(document.activeElement === launcher).toBe(true),
			);
		});
	}
}

test("canceling a sidebar rename returns focus to the page link", async () => {
	const view = setup(1024);
	const user = userEvent.setup({ document });
	await user.click(await view.findByRole("button", { name: "Page actions" }));
	await user.click(view.getByRole("menuitem", { name: "Rename" }));
	const input = await view.findByRole("textbox", { name: "Page name" });
	await act(async () => finishClosing());
	expect(document.activeElement).toBe(input);
	await user.keyboard("{Escape}");
	expect(document.activeElement).toBe(
		view.getByRole("link", { name: /Test page/ }),
	);
});

test("nested rows keep their list structure and return rename focus to the correct page", async () => {
	const view = setup(1024, [page, child, sibling]);
	const user = userEvent.setup({ document });
	const parentLink = view.getByRole("link", { name: /Test page/ });
	const parentRow = parentLink.closest("li")!;
	expect(view.queryByRole("link", { name: /Child page/ })).toBeNull();
	await user.click(within(parentRow).getByRole("button", { name: "Expand" }));
	const childLink = view.getByRole("link", { name: /Child page/ });
	expect(parentRow.contains(childLink)).toBe(false);
	expect(parentRow.nextElementSibling?.contains(childLink)).toBe(true);

	for (const title of ["Child page", "Sibling page", "Test page"]) {
		const link = view.getByRole("link", { name: new RegExp(title) });
		await user.click(
			within(link.closest("li")!).getByRole("button", { name: "Page actions" }),
		);
		await user.click(view.getByRole("menuitem", { name: "Rename" }));
		const input = view.getByRole("textbox", { name: "Page name" });
		await act(async () => finishClosing());
		expect(document.activeElement).toBe(input);
		expect((input as HTMLInputElement).value).toBe(title);
		await user.keyboard("{Escape}");
		expect(document.activeElement).toBe(
			view.getByRole("link", { name: new RegExp(title) }),
		);
	}
	await user.click(within(parentRow).getByRole("button", { name: "Collapse" }));
	expect(view.queryByRole("link", { name: /Child page/ })).toBeNull();
});

test("mobile rename keeps focus in its dialog and returns to the selected row", async () => {
	const view = setup(390, [page, sibling]);
	const user = userEvent.setup({ document });
	await user.click(view.getByRole("button", { name: "Toggle Sidebar" }));
	const row = view.getByRole("link", { name: /Sibling page/ }).closest("li")!;
	const launcher = within(row).getByRole("button", { name: "Page actions" });
	await user.click(launcher);
	await user.click(view.getByRole("button", { name: "Rename" }));
	const dialog = await view.findByRole("dialog", { name: "Rename page" });
	const input = within(dialog).getByRole("textbox", { name: "Page title" });
	await act(async () => finishClosing());
	expect((input as HTMLInputElement).value).toBe("Sibling page");
	await waitFor(() =>
		expect(dialog.contains(document.activeElement)).toBe(true),
	);
	for (let index = 0; index < 4; index++) {
		await user.tab();
		expect(dialog.contains(document.activeElement)).toBe(true);
	}
	await user.keyboard("{Escape}");
	await waitFor(() => expect(document.activeElement).toBe(launcher));
	expect(view.getByRole("link", { name: /Sibling page/ })).toBeDefined();
});

for (const width of [1024, 390]) {
	test(`renaming the selected row submits once and preserves its neighbors (${width}px)`, async () => {
		const writes: Array<{ url: string; body: unknown }> = [];
		let saved = sibling;
		const view = setup(width, [page, sibling], async (input, init) => {
			if (init?.method === "PATCH") {
				const body = JSON.parse(String(init.body));
				writes.push({ url: String(input), body });
				saved = { ...sibling, ...body };
				return Response.json(saved);
			}
			return Response.json({ items: [page, saved] });
		});
		const user = userEvent.setup({ document });
		if (width < 768)
			await user.click(view.getByRole("button", { name: "Toggle Sidebar" }));
		const row = view.getByRole("link", { name: /Sibling page/ }).closest("li")!;
		const launcher = within(row).getByRole("button", { name: "Page actions" });
		await user.click(launcher);
		await user.click(
			view.getByRole(width < 768 ? "button" : "menuitem", {
				name: "Rename",
			}),
		);
		const input = await view.findByRole("textbox", {
			name: width < 768 ? "Page title" : "Page name",
		});
		await act(async () => finishClosing());
		await user.clear(input);
		await user.type(input, "Renamed sibling");
		if (width < 768) {
			const dialog = view.getByRole("dialog", { name: "Rename page" });
			await user.click(within(dialog).getByRole("button", { name: "Rename" }));
		} else {
			await user.keyboard("{Enter}");
		}
		const renamed = await view.findByRole("link", { name: /Renamed sibling/ });
		expect(writes).toHaveLength(1);
		expect(writes[0].url.endsWith(`/api/pages/${sibling.id}`)).toBe(true);
		expect(writes[0].body).toEqual({ title: "Renamed sibling" });
		expect(view.getByRole("link", { name: /Test page/ })).toBeDefined();
		await waitFor(() =>
			expect(document.activeElement).toBe(width < 768 ? launcher : renamed),
		);
	});

	test(`viewer rows preserve navigation without edit or drag controls (${width}px)`, async () => {
		workspaceRole = "viewer";
		const view = setup(width);
		const user = userEvent.setup({ document });
		if (width < 768)
			await user.click(view.getByRole("button", { name: "Toggle Sidebar" }));
		const row = view.getByRole("link", { name: /Test page/ }).closest("li")!;
		expect(row.getAttribute("draggable")).toBe("false");
		expect(view.queryByRole("button", { name: "New page" })).toBeNull();
		await user.click(within(row).getByRole("button", { name: "Page actions" }));
		const actionRole = width < 768 ? "button" : "menuitem";
		expect(
			view.getByRole(actionRole, { name: "Add to favorites" }),
		).toBeDefined();
		for (const name of [
			"Rename",
			"Change icon",
			"Move to trash",
			"Add subpage",
		]) {
			expect(view.queryByRole(actionRole, { name })).toBeNull();
		}
	});
}

test("dropping a row moves that page into the target and keeps children outside the parent row", async () => {
	let saved = sibling;
	const writes: Array<{ url: string; body: unknown }> = [];
	const view = setup(1024, [page, sibling], async (input, init) => {
		if (init?.method === "PATCH") {
			const body = JSON.parse(String(init.body));
			writes.push({ url: String(input), body });
			saved = { ...sibling, ...body };
			return Response.json(saved);
		}
		return Response.json({ items: [page, saved] });
	});
	const sourceRow = view
		.getByRole("link", { name: /Sibling page/ })
		.closest("li")!;
	const targetRow = view
		.getByRole("link", { name: /Test page/ })
		.closest("li")!;
	const data = new Map<string, string>();
	const dataTransfer = {
		setData: (type: string, value: string) => data.set(type, value),
		getData: (type: string) => data.get(type) ?? "",
		effectAllowed: "none",
		dropEffect: "none",
	};
	fireEvent.dragStart(sourceRow, { dataTransfer });
	fireEvent.dragOver(targetRow, { dataTransfer });
	expect(sourceRow.classList.contains("opacity-50")).toBe(true);
	expect(targetRow.classList.contains("ring-2")).toBe(true);
	fireEvent.drop(targetRow, { dataTransfer });
	await waitFor(() => expect(writes).toHaveLength(1));
	expect(writes[0].url.endsWith(`/api/pages/${sibling.id}`)).toBe(true);
	expect(writes[0].body).toEqual({ parentPageId: page.id, position: 1 });
	await waitFor(() => {
		const movedLink = view.getByRole("link", { name: /Sibling page/ });
		expect(targetRow.contains(movedLink)).toBe(false);
		expect(targetRow.nextElementSibling?.contains(movedLink)).toBe(true);
	});
	expect(targetRow.classList.contains("ring-2")).toBe(false);
});

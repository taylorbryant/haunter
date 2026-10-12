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
import { act, cleanup, render, waitFor, within } from "@testing-library/react";
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
mock.module("next/navigation", () => ({
	usePathname: () => `/w/a/p/${page.id}`,
	useSearchParams: () => new URLSearchParams(),
	useRouter: () => ({ push() {}, prefetch() {} }),
}));
mock.module("@/components/app-session-provider", () => ({
	useAppSession: () => ({ workspaceRole: "owner", activeWorkspaceId: "a" }),
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

function setup(width: number) {
	window.innerWidth = width;
	closingFinished = new Promise<void>((resolve) => {
		finishClosing = resolve;
	});
	spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (input: RequestInfo | URL) => {
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
	client.setQueryData(listPagesQueryOptions("a").queryKey, { items: [page] });
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

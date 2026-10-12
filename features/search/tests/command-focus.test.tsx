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
import { cleanup, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandRegistryProvider } from "@/components/command-palette/registry";
import { DeviceTimeProvider } from "@/components/device-time-provider";
import { deviceTimeAt } from "@/lib/device-timezone";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";

const navigate = mock(() => {});
mock.module("next/navigation", () => ({
	usePathname: () => "/w/a/home",
	useSearchParams: () => new URLSearchParams(),
	useRouter: () => ({ push: navigate, prefetch() {} }),
}));
mock.module("@/components/app-session-provider", () => ({
	useCurrentUser: () => ({
		id: "tester",
		name: "Tester",
		email: "test@example.com",
	}),
	useAppSession: () => ({ workspaceRole: "owner" }),
}));

let SearchCommand: typeof import("@/components/search-command").SearchCommand;
let CreateDialogProvider: typeof import("@/components/create-dialog-provider").CreateDialogProvider;
let SidebarProvider: typeof import("@/components/ui/sidebar").SidebarProvider;
let Sidebar: typeof import("@/components/ui/sidebar").Sidebar;
let SidebarTrigger: typeof import("@/components/ui/sidebar").SidebarTrigger;
let AppCommands: typeof import("@/components/command-palette/app-commands").AppCommands;
const clients: QueryClient[] = [];

beforeAll(async () => {
	installTestDom();
	({ SearchCommand } = await import("@/components/search-command"));
	({ CreateDialogProvider } = await import(
		"@/components/create-dialog-provider"
	));
	({ SidebarProvider, Sidebar, SidebarTrigger } = await import(
		"@/components/ui/sidebar"
	));
	({ AppCommands } = await import("@/components/command-palette/app-commands"));
});
afterEach(() => {
	cleanup();
	clients.splice(0).forEach((client) => client.clear());
	mock.restore();
	navigate.mockClear();
});
afterAll(uninstallTestDom);

function setup(width = 1024) {
	window.innerWidth = width;
	spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(async () => Response.json({ favorites: [], recents: [] }), {
			preconnect: fetch.preconnect,
		}),
	);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	clients.push(client);
	return render(
		<QueryClientProvider client={client}>
			<CommandRegistryProvider>
				<AppCommands />
				<SidebarProvider>
					<DeviceTimeProvider
						initialValue={deviceTimeAt(new Date(), "UTC")}
						persistCookie={false}
					>
						<CreateDialogProvider workspaceId="a">
							<SidebarTrigger />
							<Sidebar>
								<ul>
									<SearchCommand />
								</ul>
							</Sidebar>
						</CreateDialogProvider>
					</DeviceTimeProvider>
				</SidebarProvider>
			</CommandRegistryProvider>
		</QueryClientProvider>,
	);
}

async function openSearch(
	view: ReturnType<typeof setup>,
	user: ReturnType<typeof userEvent.setup>,
	width = 1024,
) {
	if (width < 768) {
		await user.click(view.getByRole("button", { name: "Toggle Sidebar" }));
		await view.findByRole("dialog", { name: "Sidebar" });
	}
	const launcher = view.getByRole("button", { name: /^Search/ });
	await user.click(launcher);
	await view.findByRole("combobox");
	return launcher;
}

for (const width of [1024, 390]) {
	for (const method of ["keyboard", "pointer"] as const) {
		for (const [kind, name] of [
			["canvas", "Title"],
			["task", "Task name"],
			["page", "Title"],
		] as const) {
			test(`${kind} command accepts typing immediately (${method}, ${width}px)`, async () => {
				const view = setup(width);
				const user = userEvent.setup({ document });
				const launcher = await openSearch(view, user, width);
				await user.type(await view.findByRole("combobox"), `>create ${kind}`);
				if (method === "keyboard") await user.keyboard("{Enter}");
				else
					await user.click(
						view.getByRole("option", { name: new RegExp(`Create ${kind}`) }),
					);
				const input = await view.findByRole("textbox", { name });
				if (width < 768)
					await waitFor(() =>
						expect(view.queryByRole("dialog", { name: "Sidebar" })).toBeNull(),
					);
				await waitFor(() =>
					expect(document.activeElement === input).toBe(true),
				);
				await user.keyboard("A new item");
				expect((input as HTMLInputElement).value).toBe("A new item");
				const dialog = view.getByRole("dialog");
				await user.tab();
				expect(dialog.contains(document.activeElement)).toBe(true);
				await user.tab({ shift: true });
				expect(document.activeElement).toBe(input);
				await user.keyboard("{Escape}");
				await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
				await waitFor(() =>
					expect(
						document.activeElement ===
							(width < 768
								? view.getByRole("button", { name: "Toggle Sidebar" })
								: launcher),
					).toBe(true),
				);
			});
		}
	}
}

for (const width of [1024, 390]) {
	for (const method of ["keyboard", "pointer"] as const) {
		for (const destination of ["Home", "Tasks"]) {
			test(`navigation to ${destination} restores search focus (${method}, ${width}px)`, async () => {
				const view = setup(width);
				const user = userEvent.setup({ document });
				const launcher = await openSearch(view, user, width);
				await user.type(
					await view.findByRole("combobox"),
					`>go to ${destination}`,
				);
				if (method === "keyboard") await user.keyboard("{Enter}");
				else
					await user.click(
						view.getByRole("option", { name: `Go to ${destination}` }),
					);
				await waitFor(() => expect(view.queryByRole("combobox")).toBeNull());
				expect(navigate).toHaveBeenCalledWith(
					`/w/a/${destination.toLowerCase()}`,
				);
				await waitFor(() =>
					expect(document.activeElement === launcher).toBe(true),
				);
				if (width < 768) {
					const sidebar = view.getByRole("dialog", { name: "Sidebar" });
					expect(within(sidebar).getByRole("button", { name: /^Search/ })).toBe(
						launcher,
					);
				}
			});
		}
	}
}

test("dismissing the palette still returns focus after a command was run", async () => {
	const view = setup();
	const user = userEvent.setup({ document });
	const launcher = view.getByRole("button", { name: /^Search/ });
	await user.click(launcher);
	await user.type(await view.findByRole("combobox"), ">create canvas");
	await user.keyboard("{Enter}");
	await view.findByRole("textbox", { name: "Title" });
	await user.keyboard("{Escape}");
	await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
	await user.click(launcher);
	await view.findByRole("combobox");
	await user.keyboard("{Escape}");
	await waitFor(() => expect(document.activeElement === launcher).toBe(true));
});

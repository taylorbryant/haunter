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
import { CommandRegistryProvider } from "@/components/command-palette/registry";
import { DeviceTimeProvider } from "@/components/device-time-provider";
import { deviceTimeAt } from "@/lib/device-timezone";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";

mock.module("next/navigation", () => ({
	usePathname: () => "/w/a/home",
	useSearchParams: () => new URLSearchParams(),
	useRouter: () => ({ push() {}, prefetch() {} }),
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
let useCreateDialog: typeof import("@/components/create-dialog-provider").useCreateDialog;
let SidebarProvider: typeof import("@/components/ui/sidebar").SidebarProvider;
const clients: QueryClient[] = [];

beforeAll(async () => {
	installTestDom();
	({ SearchCommand } = await import("@/components/search-command"));
	({ CreateDialogProvider, useCreateDialog } = await import(
		"@/components/create-dialog-provider"
	));
	({ SidebarProvider } = await import("@/components/ui/sidebar"));
});
afterEach(() => {
	cleanup();
	clients.splice(0).forEach((client) => client.clear());
	mock.restore();
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
				<SidebarProvider>
					<DeviceTimeProvider
						initialValue={deviceTimeAt(new Date(), "UTC")}
						persistCookie={false}
					>
						<CreateDialogProvider workspaceId="a">
							<CreationButtons />
							<ul>
								<SearchCommand />
							</ul>
						</CreateDialogProvider>
					</DeviceTimeProvider>
				</SidebarProvider>
			</CommandRegistryProvider>
		</QueryClientProvider>,
	);
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
				const launcher = view.getByRole("button", { name: /^Search/ });
				await user.click(launcher);
				await user.type(await view.findByRole("combobox"), `>create ${kind}`);
				if (method === "keyboard") await user.keyboard("{Enter}");
				else
					await user.click(
						view.getByRole("option", { name: new RegExp(`Create ${kind}`) }),
					);
				const input = await view.findByRole("textbox", { name });
				await waitFor(() =>
					expect(document.activeElement === input).toBe(true),
				);
				await user.keyboard("A new item");
				expect((input as HTMLInputElement).value).toBe("A new item");
				await user.keyboard("{Escape}");
				await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
				await waitFor(() =>
					expect(document.activeElement === launcher).toBe(true),
				);
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

function CreationButtons() {
	const { openCreateCanvas, openCreatePage, openCreateTask } =
		useCreateDialog();
	return (
		<>
			<button type="button" onClick={openCreateCanvas}>
				New canvas
			</button>
			<button type="button" onClick={openCreatePage}>
				New page
			</button>
			<button type="button" onClick={openCreateTask}>
				New task
			</button>
		</>
	);
}
for (const width of [1024, 390]) {
	for (const kind of ["canvas", "page", "task"]) {
		test(`closing ${kind} creation returns to its own button after using another popup (${width}px)`, async () => {
			const view = setup(width);
			const user = userEvent.setup({ document });
			// Prime Base UI's previous-focus history with an unrelated launcher.
			await user.click(view.getByRole("button", { name: /^Search/ }));
			await view.findByRole("combobox");
			await user.keyboard("{Escape}");
			await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
			const launcher = view.getByRole("button", { name: `New ${kind}` });
			await user.click(launcher);
			const input = await view.findByRole("textbox", {
				name: kind === "task" ? "Task name" : "Title",
			});
			await waitFor(() => expect(document.activeElement).toBe(input));
			await user.keyboard("{Escape}");
			await waitFor(() => expect(document.activeElement).toBe(launcher));
		});
	}
}

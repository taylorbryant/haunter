import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlusIcon } from "lucide-react";
import { useRef, useState } from "react";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";

let WorkspacePicker: typeof import("../components/workspace-picker").WorkspacePicker;
let SidebarProvider: typeof import("@/components/ui/sidebar").SidebarProvider;
let ResponsiveDialog: typeof import("@/components/responsive-dialog").ResponsiveDialog;
beforeAll(async () => {
	installTestDom();
	({ WorkspacePicker } = await import("../components/workspace-picker"));
	({ SidebarProvider } = await import("@/components/ui/sidebar"));
	({ ResponsiveDialog } = await import("@/components/responsive-dialog"));
});
afterEach(cleanup);
afterAll(uninstallTestDom);

function Harness() {
	const [open, setOpen] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	return (
		<SidebarProvider>
			<WorkspacePicker
				workspaces={[{ id: "a", name: "Personal" }]}
				activeWorkspaceId="a"
				onSelect={() => {}}
				actions={[
					{
						label: "New workspace",
						icon: PlusIcon,
						onSelect: () => setOpen(true),
					},
				]}
			/>
			<ResponsiveDialog
				open={open}
				onOpenChange={setOpen}
				initialFocus={inputRef}
				title="New workspace"
				description="Create a workspace"
			>
				<input ref={inputRef} aria-label="Workspace name" />
				<button type="button" onClick={() => setOpen(false)}>
					Cancel
				</button>
			</ResponsiveDialog>
		</SidebarProvider>
	);
}
for (const width of [1024, 390]) {
	test(`workspace dismissal returns to the switcher (${width}px)`, async () => {
		window.innerWidth = width;
		const view = render(<Harness />);
		const user = userEvent.setup({ document });
		const launcher = view.getByRole("button", { name: "Workspace: Personal" });
		await user.click(launcher);
		await view.findByRole(width < 768 ? "dialog" : "menu");
		if (width >= 768) await user.keyboard("{ArrowDown}");
		await user.keyboard("{Escape}");
		await waitFor(() => expect(document.activeElement).toBe(launcher));
	});
	test(`workspace action keeps focus in its dialog and returns to the switcher (${width}px)`, async () => {
		window.innerWidth = width;
		const view = render(<Harness />);
		const user = userEvent.setup({ document });
		const launcher = view.getByRole("button", { name: "Workspace: Personal" });
		await user.click(launcher);
		await user.click(
			await view.findByRole(width < 768 ? "button" : "menuitem", {
				name: "New workspace",
			}),
		);
		const input = await view.findByRole("textbox", { name: "Workspace name" });
		await waitFor(() => expect(document.activeElement).toBe(input));
		await user.tab();
		expect(document.activeElement).toBe(
			view.getByRole("button", { name: "Cancel" }),
		);
		await user.tab({ shift: true });
		expect(document.activeElement).toBe(input);
		await user.keyboard("{Escape}");
		await waitFor(() => expect(document.activeElement).toBe(launcher));
	});
}

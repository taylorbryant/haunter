import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentProps, useRef, useState } from "react";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";

let CodeEditDialog: typeof import("../components/editor/code-edit-dialog").CodeEditDialog;
let Dialog: typeof import("@/components/ui/dialog").Dialog;
let DialogContent: typeof import("@/components/ui/dialog").DialogContent;
let DialogTitle: typeof import("@/components/ui/dialog").DialogTitle;
beforeAll(async () => {
	installTestDom();
	({ CodeEditDialog } = await import("../components/editor/code-edit-dialog"));
	({ Dialog, DialogContent, DialogTitle } = await import(
		"@/components/ui/dialog"
	));
});
afterEach(cleanup);
afterAll(uninstallTestDom);

for (const editable of [true, false]) {
	test(`code dialog focuses its textarea and returns to its launcher (editable=${editable})`, async () => {
		let saves = 0;
		const editor = {
			getBlock: () => ({
				type: "codeBlock",
				props: { language: "text" },
				content: [{ text: "Hello" }],
			}),
			updateBlock: () => {
				saves++;
			},
		} as unknown as ComponentProps<typeof CodeEditDialog>["editor"];
		function Harness() {
			const [open, setOpen] = useState(false);
			const [other, setOther] = useState(false);
			return (
				<>
					<button type="button" onClick={() => setOther(true)}>
						Other popup
					</button>
					<Dialog open={other} onOpenChange={setOther}>
						<DialogContent>
							<DialogTitle>Other</DialogTitle>
							<button type="button">Other action</button>
						</DialogContent>
					</Dialog>
					<button type="button" onClick={() => setOpen(true)}>
						Expand code
					</button>
					{open && (
						<CodeEditDialog
							editor={editor}
							blockId="code"
							editable={editable}
							onClose={() => setOpen(false)}
						/>
					)}
				</>
			);
		}
		const view = render(<Harness />);
		const user = userEvent.setup({ document });
		await user.click(view.getByRole("button", { name: "Other popup" }));
		await view.findByRole("dialog");
		await user.keyboard("{Escape}");
		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
		const launcher = view.getByRole("button", { name: "Expand code" });
		await user.click(launcher);
		const input = await view.findByRole("textbox", { name: "Code" });
		await waitFor(() => expect(document.activeElement).toBe(input));
		await user.keyboard("{Escape}");
		await waitFor(() => expect(document.activeElement).toBe(launcher));
		expect(saves).toBe(editable ? 1 : 0);
	});
}

test("saving code returns to the replacement node-view button", async () => {
	function Harness() {
		const [open, setOpen] = useState(false);
		const root = useRef<HTMLDivElement>(null);
		// ProseMirror replaces node-view DOM synchronously during updateBlock.
		const editor = {
			get domElement() {
				return root.current;
			},
			getBlock: () => ({
				type: "codeBlock",
				props: { language: "text" },
				content: [],
			}),
			updateBlock: () => {
				const button = root.current!.querySelector("button")!;
				button.replaceWith(button.cloneNode(true));
			},
		} as unknown as ComponentProps<typeof CodeEditDialog>["editor"];
		return (
			<>
				<div ref={root}>
					<div data-id="code">
						<button
							type="button"
							className="haunter-code-block-expand"
							onClick={() => setOpen(true)}
						>
							Expand code
						</button>
					</div>
				</div>
				{open && (
					<CodeEditDialog
						editor={editor}
						blockId="code"
						onClose={() => setOpen(false)}
					/>
				)}
			</>
		);
	}
	const view = render(<Harness />);
	const user = userEvent.setup({ document });
	const original = view.getByRole("button", { name: "Expand code" });
	await user.click(original);
	await waitFor(() =>
		expect(
			document.activeElement === view.getByRole("textbox", { name: "Code" }),
		).toBe(true),
	);
	await user.type(view.getByRole("textbox", { name: "Code" }), "Updated code");
	await user.click(view.getByRole("button", { name: "Close code editor" }));
	const replacement = await view.findByRole("button", { name: "Expand code" });
	expect(replacement === original).toBe(false);
	await waitFor(() =>
		expect(document.activeElement === replacement).toBe(true),
	);
});

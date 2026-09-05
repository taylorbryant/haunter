import { afterEach, beforeEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CanvasBlockHeader } from "@/features/pages/components/editor/canvas-block-header";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";

beforeEach(installTestDom);
afterEach(() => {
	cleanup();
	uninstallTestDom();
});

test("canvas header announces saving and exposes the correct fullscreen action", async () => {
	const user = userEvent.setup({ document });
	let toggles = 0;
	const view = render(
		<CanvasBlockHeader
			expanded={false}
			saveState="saving"
			onToggle={() => {
				toggles += 1;
			}}
		/>,
	);

	expect(view.getByText("Saving…").getAttribute("aria-live")).toBe("polite");
	await user.click(view.getByRole("button", { name: "Expand canvas" }));
	expect(toggles).toBe(1);

	view.rerender(
		<CanvasBlockHeader
			expanded
			saveState="saved"
			onToggle={() => {
				toggles += 1;
			}}
		/>,
	);
	expect(view.getByRole("button", { name: "Close canvas" })).not.toBeNull();
	expect(view.queryByText("Saving…")).toBeNull();
});

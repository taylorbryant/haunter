import { afterEach, beforeEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CANVAS_LIBRARY_ITEMS } from "@/features/canvases/lib/library";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";

beforeEach(installTestDom);
afterEach(async () => {
	cleanup();
	await uninstallTestDom();
});

test("library items render every wireframe preview and insert the selected item", async () => {
	const user = userEvent.setup({ document });
	const { LibraryItemButton } = await import(
		"@/features/canvases/components/canvas-library"
	);
	const selected: string[] = [];
	const wireframes = CANVAS_LIBRARY_ITEMS.filter(
		(item) => item.kind === "component" && item.category === "wireframes",
	);
	const view = render(
		<LibraryItemButton
			entry={wireframes[0] as (typeof wireframes)[number]}
			onInsert={(entry) => selected.push(entry.id)}
		/>,
	);

	for (const entry of wireframes) {
		view.rerender(
			<LibraryItemButton
				entry={entry}
				onInsert={(item) => selected.push(item.id)}
			/>,
		);
		expect(view.getByRole("button", { name: entry.name })).not.toBeNull();
	}

	const taskRow = wireframes.find((entry) => entry.id === "task-row");
	expect(taskRow).toBeDefined();
	if (!taskRow) return;
	view.rerender(
		<LibraryItemButton
			entry={taskRow}
			onInsert={(entry) => selected.push(entry.id)}
		/>,
	);
	await user.click(view.getByRole("button", { name: taskRow.name }));
	expect(selected).toEqual(["task-row"]);
});

test("library interaction boundary claims pointer and touch input", async () => {
	const { CanvasLibraryInteractionBoundary } = await import(
		"@/features/canvases/components/canvas-library"
	);
	let interactions = 0;
	const view = render(
		<CanvasLibraryInteractionBoundary
			onInteraction={() => {
				interactions += 1;
			}}
		>
			<button type="button">Library</button>
		</CanvasLibraryInteractionBoundary>,
	);
	const button = view.getByRole("button", { name: "Library" });
	fireEvent.pointerDown(button);
	fireEvent.pointerMove(button);
	fireEvent.pointerUp(button);
	fireEvent.touchStart(button);
	fireEvent.touchEnd(button);
	expect(interactions).toBe(5);
});

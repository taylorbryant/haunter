import { afterEach, beforeEach, expect, test } from "bun:test";
import { waitFor } from "@testing-library/react";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import { observeEmbeddedTextSelection } from "../client/embedded-text-selection";
import { MAX_SELECTION_CHARACTERS } from "../mcp-app/editor-schema";

let stop: (() => void) | undefined;
beforeEach(installTestDom);
afterEach(async () => {
	stop?.();
	stop = undefined;
	await uninstallTestDom();
});
function select(node: Node | null) {
	const selection = window.getSelection();
	selection?.removeAllRanges();
	if (node) {
		const range = document.createRange();
		range.selectNodeContents(node);
		selection?.addRange(range);
	}
	document.dispatchEvent(new Event("selectionchange"));
}
test("automatically shares only the active page selection, bounds large passages, and clears stale content", async () => {
	document.body.innerHTML =
		'<div data-haunter-editor-page="page"><p id="inside">Live unsaved passage</p><div class="haunter-canvas"><p id="canvas">Canvas text</p></div></div><p id="outside">Outside text</p>';
	const updates: Array<{ text: string; complete: boolean }> = [];
	stop = observeEmbeddedTextSelection("page", (value) => updates.push(value));
	select(document.getElementById("inside"));
	await waitFor(() =>
		expect(updates.at(-1)?.text).toBe("Live unsaved passage"),
	);
	select(document.getElementById("canvas"));
	await waitFor(() => expect(updates.at(-1)?.text).toBe(""));
	select(document.getElementById("outside"));
	await waitFor(() => expect(updates.at(-1)?.text).toBe(""));
	document.getElementById("inside")!.textContent = "x".repeat(
		MAX_SELECTION_CHARACTERS + 100,
	);
	select(document.getElementById("inside"));
	await waitFor(() =>
		expect(updates.at(-1)).toEqual({
			text: "x".repeat(MAX_SELECTION_CHARACTERS),
			complete: false,
		}),
	);
	select(null);
	await waitFor(() => expect(updates.at(-1)?.text).toBe(""));
});
test("coalesces drag events and cancels a pending selection on teardown", async () => {
	document.body.innerHTML = '<p data-haunter-editor-page="page">Latest</p>';
	const updates: string[] = [];
	stop = observeEmbeddedTextSelection("page", (value) =>
		updates.push(value.text),
	);
	for (let i = 0; i < 10; i++) select(document.querySelector("p"));
	await waitFor(() => expect(updates).toEqual(["Latest"]));
	select(null);
	stop();
	await Bun.sleep(160);
	expect(updates).toEqual(["Latest"]);
});

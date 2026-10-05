import { afterEach, beforeEach, expect, test } from "bun:test";
import { waitFor } from "@testing-library/react";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import { validateEditorOutput } from "../mcp-app/editor-schema";
import {
	destination,
	element,
	fixture,
	pageId,
	template,
} from "./mcp-app-fixture";
const canvasId = "22361203-b2ae-4a16-86d6-98d4c01f5d9a";
const canvas = {
	...destination(),
	canvasId,
	title: "Architecture",
	editorUrl: `https://haunter.test/embed/w/workspace-one/c/${canvasId}`,
	webUrl: `https://haunter.test/w/workspace-one/c/${canvasId}`,
};
let f: ReturnType<typeof fixture>;
beforeEach(() => {
	installTestDom();
	document.body.innerHTML = template;
});
afterEach(async () => {
	f?.companion.dispose();
	await uninstallTestDom();
});
function setup() {
	f = fixture({
		callTool: async (name, args) =>
			name === "open_haunter_canvas" ? canvas : f.defaultCall(name, args),
	});
}
test("inline canvas selection replaces text selection without navigating away from the page", async () => {
	setup();
	await f.open();
	f.emit("haunter/editor/selection", { text: "Selected page text" });
	const original = f.frame.src;
	const selection = {
		canvasPageId: "page:one",
		selectedShapeIds: ["shape:box"],
		selectionCount: 1,
		selectionComplete: true,
	};
	f.emit("haunter/editor/inline-canvas-selection", { canvasId, selection });
	await waitFor(() =>
		expect(f.contexts.at(-1)?.view?.inlineCanvas).toEqual({
			canvasId,
			selection,
		}),
	);
	expect(f.contexts.at(-1)?.view?.pageId).toBe(pageId);
	expect(f.contexts.at(-1)?.view?.selection).toBeUndefined();
	expect(f.frame.src).toBe(original);
	f.emit("haunter/editor/inline-canvas-selection", {
		canvasId: null,
		selection: null,
	});
	await waitFor(() =>
		expect(f.contexts.at(-1)?.view?.inlineCanvas).toBeUndefined(),
	);
	f.emit(
		"haunter/editor/inline-canvas-selection",
		{ canvasId, selection },
		{ origin: "https://unrelated.test" },
	);
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(f.contexts.at(-1)?.view?.inlineCanvas).toBeUndefined();
});
test("canvas destinations bind the resource and reject page paths or other origins", () => {
	expect(validateEditorOutput(canvas)).toEqual(canvas);
	for (const changed of [
		{ canvasId: crypto.randomUUID() },
		{ editorUrl: destination().editorUrl },
		{ webUrl: "https://other.test/" },
	])
		expect(() => validateEditorOutput({ ...canvas, ...changed })).toThrow();
});
test("canvas blocks open the interactive canvas, share bounded selection metadata, and return to the page", async () => {
	setup();
	await f.open();
	f.emit("haunter/editor/selection", { text: "Page selection" });
	f.emit("haunter/editor/open-canvas", { canvasId });
	await waitFor(() => expect(f.frame.src).toContain(`/c/${canvasId}`));
	await waitFor(() => expect(f.contexts.at(-1)?.view?.canvasId).toBe(canvasId));
	const selection = {
		canvasPageId: "page:one",
		selectedShapeIds: ["shape:box"],
		selectionCount: 1,
		selectionComplete: true,
	};
	f.emit("haunter/editor/canvas-selection", { selection });
	await waitFor(() =>
		expect(f.contexts.at(-1)?.view?.canvas).toEqual(selection),
	);
	expect(f.contexts.at(-1)?.text).toContain("read_canvas");
	expect(f.contexts.at(-1)?.view?.selection).toBeUndefined();
	const count = f.contexts.length;
	f.emit("haunter/editor/canvas-selection", { selection });
	f.emit("haunter/editor/canvas-selection", {
		selection: { ...selection, selectedShapeIds: ["shape:spoof"] },
		nonce: "old",
	});
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(f.contexts).toHaveLength(count);
	f.emit("haunter/editor/authorize", {
		requestId: crypto.randomUUID(),
		challenge: "x".repeat(43),
	});
	await waitFor(() =>
		expect(f.calls.at(-1)).toMatchObject({
			name: "authorize_haunter_editor",
			args: { workspaceId: "workspace-one", canvasId },
		}),
	);
	expect(f.calls.at(-1)?.args).not.toHaveProperty("pageId");
	f.emit("haunter/editor/open-page", { pageId });
	await waitFor(() => expect(f.frame.src).toContain(`/p/${pageId}`));
	await waitFor(() =>
		expect(f.contexts.at(-1)?.view?.canvasId).toBeUndefined(),
	);
	expect(f.contexts.at(-1)?.view?.canvas).toBeUndefined();
});
test("unsaved canvas changes block navigation and closing; direct canvas opening preserves selection scope", async () => {
	setup();
	await f.companion.initialize(canvas);
	f.settings.saved = false;
	const original = f.frame.src;
	f.emit("haunter/editor/save-status", { status: "unsaved" });
	f.emit("haunter/editor/open-page", { pageId });
	await waitFor(() =>
		expect(element("page-status").textContent).toContain("Keep this page open"),
	);
	expect(f.frame.src).toBe(original);
	expect(f.contexts.at(-1)?.view).toMatchObject({
		canvasId,
		saveStatus: "unsaved",
	});
	await expect(f.companion.prepareClose()).rejects.toThrow();
	f.settings.saved = true;
	await f.companion.prepareClose();
	expect(f.contexts.at(-1)?.view).toBeUndefined();
});

import { beforeEach, afterEach, expect, test } from "bun:test";
import { waitFor } from "@testing-library/react";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import {
	fixture,
	template,
	element,
	pageId,
	childId,
	savedPage,
	child,
} from "./mcp-app-fixture";
let f: ReturnType<typeof fixture>;
beforeEach(async () => {
	await installTestDom();
	document.body.innerHTML = template;
});
afterEach(async () => {
	f?.companion.dispose();
	await uninstallTestDom();
});

test("the editor receives page metadata immediately, and cursor creation is scoped to its current page", async () => {
	f = fixture({
		callTool: async (name, args) =>
			name === "act_in_haunter_workspace"
				? { id: childId }
				: f.defaultCall(name, args),
	});
	await f.open();
	const readId = crypto.randomUUID();
	f.emit("haunter/editor/workspace-request", {
		requestId: readId,
		request: { action: "list-pages" },
	});
	await waitFor(() =>
		expect(
			f.messages.some((m) => m.requestId === readId && m.result),
		).toBeTrue(),
	);
	const requestId = crypto.randomUUID();
	f.emit("haunter/editor/workspace-request", {
		requestId,
		request: {
			action: "create-canvas",
			pageId: childId,
			workspaceId: "other-workspace",
		},
	});
	await waitFor(() =>
		expect(
			f.messages.some((m) => m.requestId === requestId && m.result),
		).toBeTrue(),
	);
	expect(
		f.calls.find((c) => c.name === "act_in_haunter_workspace")?.args,
	).toEqual({
		workspaceId: "workspace-one",
		operation: { action: "create-canvas", pageId },
	});
	const before = f.calls.length;
	f.emit(
		"haunter/editor/workspace-request",
		{
			requestId: crypto.randomUUID(),
			request: { action: "archive-page", pageId },
		},
		{ origin: "https://wrong.test" },
	);
	expect(f.calls.length).toBe(before);
});

test("read-only workspace hides mutation availability and switching scope clears favorites and canvases", async () => {
	f = fixture({
		callTool: async (name, args) =>
			name === "get_haunter_workspace"
				? {
						pages: [savedPage, child],
						canEdit: false,
						favorites: args.workspaceId === "workspace-one" ? [pageId] : [],
						canvasFavorites: [],
						canvases: [],
					}
				: f.defaultCall(name, args),
	});
	await f.open();
	expect(element<HTMLButtonElement>("new-page").disabled).toBeTrue();
	expect(element<HTMLButtonElement>("favorite-item").disabled).toBeTrue();
	expect(element("favorites-list").textContent).toContain(savedPage.title);
	const workspace = element<HTMLSelectElement>("workspace");
	workspace.value = "workspace-two";
	workspace.dispatchEvent(new Event("change"));
	await waitFor(() => expect(element("favorites-section").hidden).toBeTrue());
	expect(element("favorites-list").textContent).toBe("");
});

test("linked page navigation uses the normal save guard", async () => {
	f = fixture();
	await f.open();
	f.settings.saved = false;
	const src = f.frame.src;
	f.emit("haunter/editor/open-page", {
		pageId: childId,
		workspaceId: "workspace-one",
	});
	await waitFor(() =>
		expect(element("page-status").textContent).toContain("Keep this page open"),
	);
	expect(f.frame.src).toBe(src);
	expect(f.frame.inert).toBeFalse();
});

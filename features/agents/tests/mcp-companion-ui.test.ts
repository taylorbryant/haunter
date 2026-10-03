import { afterEach, beforeEach, expect, test } from "bun:test";
import { waitFor } from "@testing-library/react";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import {
	MAX_CONTEXT_CHARACTERS,
	pageContextText,
	parsePageResourceUri,
} from "../mcp-app/schemas";
import {
	child,
	childId,
	destination,
	element,
	fixture,
	pageId,
	savedPage,
	template,
	workspaces,
} from "./mcp-app-fixture";
let f: ReturnType<typeof fixture>;
beforeEach(() => {
	installTestDom();
	document.body.innerHTML = template;
});
afterEach(async () => {
	f?.companion.dispose();
	await uninstallTestDom();
});

test("workspace navigation shares current-page metadata without attaching content", async () => {
	f = fixture();
	await f.companion.initialize({ workspaces });
	expect(f.frame.hidden).toBeTrue();
	f.clickPage(pageId);
	await waitFor(() => expect(f.frame.src).toContain(destination().editorUrl));
	await waitFor(() => expect(f.contexts.at(-1)?.view?.pageId).toBe(pageId));
	expect(f.contexts.at(-1)?.page).toBeUndefined();
	expect(f.contexts.at(-1)?.text).not.toContain(savedPage.markdown);
	expect(element("breadcrumbs").textContent).toBe("ProductLaunch plan");
});

test("explicit saved-page context flushes first and reads the latest saved revision", async () => {
	f = fixture({
		async callTool(name, args) {
			return name === "read_page"
				? {
						...savedPage,
						title: "Updated launch",
						revision: "revision-two",
						markdown: "Newest saved content.",
					}
				: f.defaultCall(name, args);
		},
	});
	await f.open();
	f.settings.autoFlush = false;
	element("use-context").click();
	expect(f.calls.some((call) => call.name === "read_page")).toBeFalse();
	const request = f.messages.at(-1);
	f.emit("haunter/editor/flushed", {
		requestId: request?.requestId,
		locallySaved: true,
		saved: true,
	});
	await waitFor(() => expect(f.contexts.at(-1)?.page).toBeDefined());
	expect(f.contexts.at(-1)?.text).toContain("Newest saved content.");
	expect(f.contexts.at(-1)?.page?.revision).toBe("revision-two");
	expect(element("breadcrumbs").textContent).toContain("Updated launch");
	f.companion.syncContext(null);
	expect(element("remove-context").hidden).toBeTrue();
});

test("search and nested navigation preserve the active editor and explicit context", async () => {
	f = fixture();
	await f.open(childId);
	expect(element("breadcrumbs").textContent).toBe(
		"ProductLaunch planRelease checklist",
	);
	element("use-context").click();
	await waitFor(() => expect(f.contexts.at(-1)?.page).toBeDefined());
	const source = f.frame.src;
	element<HTMLInputElement>("query").value = "release";
	element("search-form").dispatchEvent(new Event("submit"));
	await waitFor(() =>
		expect(f.calls.some((call) => call.name === "search_pages")).toBeTrue(),
	);
	expect(f.frame.src).toBe(source);
	element("home").click();
	await waitFor(() => expect(f.frame.hidden).toBeTrue());
	await waitFor(() =>
		expect(element<HTMLButtonElement>("home").disabled).toBeFalse(),
	);
	expect(f.contexts.at(-1)?.view).toBeUndefined();
	expect(f.contexts.at(-1)?.page?.pageId).toBe(childId);
	expect(element("context-status").textContent).toContain(child.title);
	expect(element<HTMLInputElement>("query").value).toBe("");
	expect(element(`children-${pageId}`).hidden).toBeFalse();
});

test("page, workspace, Home, and refresh keep the current frame on an unconfirmed save", async () => {
	f = fixture();
	await f.open();
	f.settings.saved = false;
	const source = f.frame.src;
	for (const navigate of [
		() => f.clickPage(childId),
		() => {
			const select = element<HTMLSelectElement>("workspace");
			select.value = "workspace-two";
			select.dispatchEvent(new Event("change"));
		},
		() => element("home").click(),
		() => element("refresh").click(),
	]) {
		navigate();
		await waitFor(() =>
			expect(element<HTMLButtonElement>("home").disabled).toBeFalse(),
		);
		expect(f.frame.src).toBe(source);
		expect(f.frame.hidden).toBeFalse();
		expect(f.frame.inert).toBeFalse();
		expect(element("page-status").textContent).toContain("Keep this page open");
		expect(element<HTMLSelectElement>("workspace").value).toBe("workspace-one");
	}
	f.settings.saved = true;
	f.clickPage(childId);
	await waitFor(() => expect(f.frame.src).toContain(childId));
	expect(f.frame.src).not.toBe(source);
});

test("navigation serializes delayed reads so a second action cannot replace the selected workspace", async () => {
	let resolveRead: (data: unknown) => void = () => {};
	f = fixture({
		async callTool(name, args) {
			return name === "open_haunter_editor"
				? new Promise((resolve) => {
						resolveRead = resolve;
					})
				: f.defaultCall(name, args);
		},
	});
	await f.companion.initialize({ workspaces });
	f.clickPage(pageId);
	expect(element<HTMLSelectElement>("workspace").disabled).toBeTrue();
	const select = element<HTMLSelectElement>("workspace");
	select.value = "workspace-two";
	select.dispatchEvent(new Event("change"));
	resolveRead(destination());
	await waitFor(() => expect(f.frame.src).toContain(pageId));
	expect(select.value).toBe("workspace-one");
});

test("denied reads cannot share cached content or destroy a draft, and missing context support disables attachment", async () => {
	f = fixture({
		async callTool(name, args) {
			if (name === "read_page")
				throw new Error("This MCP connection is not active.");
			return f.defaultCall(name, args);
		},
	});
	await f.open();
	const source = f.frame.src;
	element("use-context").click();
	await waitFor(() =>
		expect(element("page-status").textContent).toContain("not active"),
	);
	expect(f.contexts.every((entry) => !entry.page)).toBeTrue();
	expect(f.frame.src).toBe(source);
	f.companion.dispose();
	// A different host can still browse even if it cannot accept context.
	document.body.innerHTML = template;
	f = fixture({ canUseContext: () => false });
	await f.open();
	expect(element<HTMLButtonElement>("use-context").disabled).toBeTrue();
	expect(element("context-help").textContent).toContain("unavailable");
	f.emit("haunter/editor/selection", { text: "Private text" });
	expect(f.contexts).toEqual([]);
});

test("large page context is bounded and resource identifiers reject noncanonical paths", () => {
	const text = pageContextText(workspaces[0], {
		...savedPage,
		markdown: "x".repeat(MAX_CONTEXT_CHARACTERS + 1),
	});
	expect(text).toContain("[Page truncated.");
	expect(text.length).toBeLessThan(MAX_CONTEXT_CHARACTERS + 500);
	for (const uri of [
		`haunter://workspaces/workspace-one/pages/${pageId}/extra`,
		`haunter://workspaces/%2e%2e/pages/${pageId}`,
		`file:///tmp/${pageId}`,
	])
		expect(() => parsePageResourceUri(uri)).toThrow();
});

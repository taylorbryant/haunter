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

test("search preserves the current selection and Home clears it", async () => {
	f = fixture();
	await f.open(childId);
	expect(element("breadcrumbs").textContent).toBe(
		"ProductLaunch planRelease checklist",
	);
	f.emit("haunter/editor/selection", { text: "Selected live passage" });
	await waitFor(() =>
		expect(f.contexts.at(-1)?.view?.selection?.text).toBe(
			"Selected live passage",
		),
	);
	const source = f.frame.src;
	element<HTMLInputElement>("query").value = "release";
	element("search-form").dispatchEvent(new Event("submit"));
	await waitFor(() =>
		expect(f.calls.some((call) => call.name === "search_pages")).toBeTrue(),
	);
	expect(f.frame.src).toBe(source);
	expect(f.contexts.at(-1)?.view?.selection?.text).toBe(
		"Selected live passage",
	);
	element("home").click();
	await waitFor(() => expect(f.frame.hidden).toBeTrue());
	await waitFor(() =>
		expect(element<HTMLButtonElement>("home").disabled).toBeFalse(),
	);
	expect(f.contexts.at(-1)?.view).toBeUndefined();
	expect(f.contexts.at(-1)?.text).not.toContain("Selected live passage");
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

test("a host without model-context support can still edit without sending selections", async () => {
	f = fixture({ canUseContext: () => false });
	await f.open();
	f.emit("haunter/editor/selection", { text: "Private text" });
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(f.contexts).toEqual([]);
	expect(f.frame.hidden).toBeFalse();
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

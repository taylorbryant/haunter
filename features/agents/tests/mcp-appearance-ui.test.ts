import { afterEach, beforeEach, expect, test } from "bun:test";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import { element, fixture, pageId, template } from "./mcp-app-fixture";

let f: ReturnType<typeof fixture>;
beforeEach(() => {
	installTestDom();
	document.body.innerHTML = template;
});
afterEach(async () => {
	f?.companion.dispose();
	await uninstallTestDom();
});

test("a named theme survives host updates and reopening without changing web preferences", async () => {
	localStorage.setItem("haunter-dark-theme", "nord");
	f = fixture();
	await f.open();
	const select = element<HTMLSelectElement>("appearance-theme");
	select.value = "dracula";
	select.dispatchEvent(new Event("change"));
	f.companion.applyTheme("light");
	expect(document.documentElement.dataset.theme).toBe("dracula");
	expect(document.documentElement.style.colorScheme).toBe("dark");
	expect(f.messages).toContainEqual(
		expect.objectContaining({ type: "haunter/editor/theme", theme: "dracula" }),
	);
	expect(localStorage.getItem("haunter-dark-theme")).toBe("nord");
	f.companion.dispose();
	document.body.innerHTML = template;
	f = fixture();
	await f.open();
	expect(element<HTMLSelectElement>("appearance-theme").value).toBe("dracula");
	expect(document.documentElement.dataset.theme).toBe("dracula");
	const reopened = element<HTMLSelectElement>("appearance-theme");
	reopened.value = "host";
	reopened.dispatchEvent(new Event("change"));
	f.companion.applyTheme("light");
	expect(document.documentElement.dataset.theme).toBe("light");
	f.companion.applyTheme("dark");
	expect(document.documentElement.dataset.theme).toBe("dark");
});

test("collapsing and expanding keeps the live frame, selection and unsaved content", async () => {
	f = fixture();
	await f.open();
	f.emit("haunter/editor/save-status", { status: "unsaved" });
	f.settings.saved = false;
	f.emit("haunter/editor/selection", { text: "Current selection" });
	const source = f.frame.src;
	const calls = f.calls.length;
	const messages = f.messages.length;
	element("sidebar-toggle").click();
	expect(element("workspace-sidebar").hidden).toBeTrue();
	expect(element("sidebar-toggle").getAttribute("aria-expanded")).toBe("false");
	expect(localStorage.getItem("haunter-mcp-sidebar-expanded")).toBe("false");
	element("sidebar-toggle").click();
	expect(element("workspace-sidebar").hidden).toBeFalse();
	expect(f.frame.src).toBe(source);
	expect(f.calls.length).toBe(calls);
	expect(f.messages.length).toBe(messages);
});

test("narrow navigation reveals the existing editor when its current page is selected", async () => {
	Object.defineProperty(window, "innerWidth", { value: 390 });
	f = fixture();
	await f.open();
	const source = f.frame.src;
	expect(element("workspace-sidebar").hidden).toBeTrue();
	element("sidebar-toggle").click();
	expect(element("workspace-sidebar").hidden).toBeFalse();
	f.clickPage(pageId);
	expect(element("workspace-sidebar").hidden).toBeTrue();
	expect(f.frame.src).toBe(source);
	expect(localStorage.getItem("haunter-mcp-sidebar-expanded")).toBeNull();
});

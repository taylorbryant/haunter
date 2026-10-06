import { afterEach, beforeEach, expect, test } from "bun:test";
import { waitFor } from "@testing-library/react";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import type { ContextSnapshot } from "../mcp-app/model-context";
import {
	childId,
	destination,
	element,
	fixture,
	pageId,
	savedPage,
	template,
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
const current = () => f.contexts.at(-1);
async function selected(text = "Selected passage") {
	f.emit("haunter/editor/selection", { text });
	await waitFor(() => expect(current()?.view?.selection?.text).toBe(text));
}

test("opening, renaming and save transitions update metadata without a page read or document content", async () => {
	f = fixture();
	f.settings.autoReady = false;
	await f.open();
	await waitFor(() => expect(current()?.view?.editorStatus).toBe("opening"));
	f.emit("haunter/editor/status", { status: "ready" });
	f.emit("haunter/editor/metadata", { title: "Renamed launch", icon: null });
	f.emit("haunter/editor/save-status", { status: "unsaved" });
	await waitFor(() =>
		expect(current()?.view).toEqual({
			workspaceId: "workspace-one",
			workspaceName: "Product",
			pageId,
			title: "Renamed launch",
			url: destination().webUrl,
			source: `haunter://workspaces/workspace-one/pages/${pageId}`,
			editorStatus: "ready",
			saveStatus: "unsaved",
		}),
	);
	f.emit("haunter/editor/save-status", { status: "saved" });
	await waitFor(() => expect(current()?.view?.saveStatus).toBe("saved"));
	expect(current()?.page).toBeUndefined();
	expect(current()?.text).not.toContain(savedPage.markdown);
	expect(f.calls.some((call) => call.name === "read_page")).toBeFalse();
	const count = f.contexts.length;
	f.emit("haunter/editor/save-status", { status: "saved" });
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(f.contexts).toHaveLength(count);
});

test("navigation and Home clear the live selection", async () => {
	f = fixture();
	await f.open();
	await selected();
	f.clickPage(childId);
	await waitFor(() => expect(current()?.view?.pageId).toBe(childId));
	expect(current()?.view?.selection).toBeUndefined();
	expect(current()?.text).not.toContain("Selected passage");
	await selected("Another selection");
	element("home").click();
	await waitFor(() => expect(current()?.view).toBeUndefined());
	expect(current()?.text).not.toContain("Another selection");
});

test("workspace switching and refresh clear current-page identity", async () => {
	f = fixture();
	await f.open();
	const select = element<HTMLSelectElement>("workspace");
	select.value = "workspace-two";
	select.dispatchEvent(new Event("change"));
	await waitFor(() =>
		expect(element<HTMLButtonElement>("home").disabled).toBeFalse(),
	);
	await waitFor(() => expect(current()?.view).toBeUndefined());
	f.clickPage(pageId);
	await waitFor(() =>
		expect(current()?.view?.workspaceId).toBe("workspace-two"),
	);
	expect(current()?.view?.workspaceName).toBe("Team");
	element("refresh").click();
	await waitFor(() => expect(current()?.view).toBeUndefined());
});

test("a rejected navigation keeps the current page and marks access failures unavailable", async () => {
	f = fixture();
	await f.open();
	f.settings.saved = false;
	f.clickPage(childId);
	await waitFor(() =>
		expect(element("page-status").textContent).toContain("Keep this page open"),
	);
	expect(current()?.view?.pageId).toBe(pageId);
	f.emit("haunter/editor/status", { status: "access-denied" });
	await waitFor(() =>
		expect(current()?.view?.editorStatus).toBe("unavailable"),
	);
	expect(current()?.view?.saveStatus).toBe("unknown");
});

test("wrong origins and stale frames cannot rename a page or falsify save status", async () => {
	f = fixture();
	await f.open();
	f.emit("haunter/editor/save-status", { status: "saved" });
	await waitFor(() => expect(current()?.view?.saveStatus).toBe("saved"));
	const nonce = new URL(f.frame.src).searchParams.get("nonce");
	f.clickPage(childId);
	await waitFor(() => expect(current()?.view?.pageId).toBe(childId));
	f.emit("haunter/editor/metadata", { title: "Wrong", icon: null, nonce });
	f.emit("haunter/editor/save-status", { status: "saved", nonce });
	f.emit(
		"haunter/editor/metadata",
		{ title: "Wrong origin", icon: null },
		{ origin: "https://other.test" },
	);
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(current()?.view?.title).toBe("Release checklist");
	expect(current()?.view?.saveStatus).toBe("unknown");
});

test("host removal suppresses a selection until it changes, including stale acknowledgements", async () => {
	f = fixture();
	f.companion.syncContext(null);
	await f.open();
	await selected();
	const previous = current();
	const updateId = `update-${f.contexts.length}`;
	f.companion.syncContext(null);
	f.companion.syncContext({ ...previous, updateId });
	f.emit("haunter/editor/save-status", { status: "saved" });
	await waitFor(() => expect(current()?.view?.selection).toBeUndefined());
	expect(current()?.view?.pageId).toBe(pageId);
	await selected("A different selection");
});

test("a previous host selection is never restored into another page", async () => {
	f = fixture();
	await f.open();
	await selected();
	const snapshot = current();
	f.companion.dispose();
	document.body.innerHTML = template;
	f = fixture();
	f.companion.syncContext({ ...snapshot, updateId: "old-context" });
	await f.open(childId);
	await waitFor(() => expect(current()?.view?.pageId).toBe(childId));
	expect(current()?.view?.selection).toBeUndefined();
	expect(current()?.text).not.toContain("Selected passage");
});

test("clearing selection during a pending context write wins over the old selection", async () => {
	const received: ContextSnapshot[] = [];
	let release: () => void = () => {};
	let block = false;
	f = fixture({
		async setContext(snapshot) {
			received.push(snapshot);
			if (block)
				await new Promise<void>((resolve) => {
					release = resolve;
				});
			return { updateId: `received-${received.length}` };
		},
	});
	await f.open();
	await waitFor(() =>
		expect(received.at(-1)?.structuredContent.haunterView?.editorStatus).toBe(
			"ready",
		),
	);
	block = true;
	f.emit("haunter/editor/selection", { text: "Stale selection" });
	await waitFor(() =>
		expect(
			received.at(-1)?.structuredContent.haunterView?.selection?.text,
		).toBe("Stale selection"),
	);
	f.emit("haunter/editor/selection", { text: "" });
	block = false;
	release();
	await waitFor(() =>
		expect(
			received.at(-1)?.structuredContent.haunterView?.selection,
		).toBeUndefined(),
	);
	expect(received.at(-1)?.structuredContent.haunterView?.pageId).toBe(pageId);
});

test("context errors do not block editing, and later navigation retries with the latest page", async () => {
	let fail = true;
	const received: ContextSnapshot[] = [];
	f = fixture({
		async setContext(snapshot) {
			if (fail) throw new Error("Host unavailable");
			received.push(snapshot);
		},
	});
	await f.open();
	await waitFor(() =>
		expect(element("context-status").textContent).toContain("could not sync"),
	);
	expect(f.frame.hidden).toBeFalse();
	fail = false;
	f.clickPage(childId);
	await waitFor(() =>
		expect(received.at(-1)?.structuredContent.haunterView?.pageId).toBe(
			childId,
		),
	);
	expect(element("context-status").textContent).not.toContain("could not sync");
});

test("slow context writes are serialized and finish with the latest page", async () => {
	const received: ContextSnapshot[] = [];
	let release: () => void = () => {};
	let block = false;
	f = fixture({
		async setContext(snapshot) {
			received.push(snapshot);
			if (block)
				await new Promise<void>((resolve) => {
					release = resolve;
				});
		},
	});
	await f.open();
	await waitFor(() =>
		expect(received.at(-1)?.structuredContent.haunterView?.pageId).toBe(pageId),
	);
	block = true;
	f.emit("haunter/editor/metadata", { title: "Older title", icon: null });
	await waitFor(() =>
		expect(received.at(-1)?.structuredContent.haunterView?.title).toBe(
			"Older title",
		),
	);
	f.clickPage(childId);
	await waitFor(() => expect(f.frame.src).toContain(childId));
	block = false;
	release();
	await waitFor(() =>
		expect(received.at(-1)?.structuredContent.haunterView?.pageId).toBe(
			childId,
		),
	);
});

test("teardown clears the live view and selection and ignores late editor events", async () => {
	f = fixture();
	await f.open();
	await selected();
	f.settings.saved = false;
	await expect(f.companion.prepareClose()).rejects.toThrow(
		"Keep this page open",
	);
	expect(current()?.view?.pageId).toBe(pageId);
	f.settings.saved = true;
	await f.companion.prepareClose();
	expect(current()?.view).toBeUndefined();
	expect(current()?.text).not.toContain("Selected passage");
	f.emit("haunter/editor/save-status", { status: "saved" });
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(current()?.view).toBeUndefined();
});

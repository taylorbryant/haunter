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
async function attached() {
	element("use-context").click();
	await waitFor(() => expect(current()?.page?.pageId).toBe(pageId));
	await waitFor(() =>
		expect(element<HTMLButtonElement>("home").disabled).toBeFalse(),
	);
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

test("navigation preserves an explicit snapshot while tracking a different current page", async () => {
	f = fixture();
	await f.open();
	await attached();
	const attachmentText = current()?.content[1]?.text;
	f.clickPage(childId);
	await waitFor(() => expect(current()?.view?.pageId).toBe(childId));
	expect(current()?.page?.pageId).toBe(pageId);
	expect(current()?.content[1]?.text).toBe(attachmentText);
	f.emit("haunter/editor/metadata", {
		title: "New checklist title",
		icon: null,
	});
	await waitFor(() =>
		expect(current()?.view?.title).toBe("New checklist title"),
	);
	expect(current()?.content[1]?.text).toBe(attachmentText);
	element("home").click();
	await waitFor(() => expect(current()?.view).toBeUndefined());
	expect(current()?.page?.pageId).toBe(pageId);
	expect(current()?.content[1]?.text).toBe(attachmentText);
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

test("removing an attachment in the host does not restore it on navigation or a stale acknowledgement", async () => {
	f = fixture();
	// Hosts may start with a null slot and acknowledge updates without sending
	// a separate host-context notification before the user removes the slot.
	f.companion.syncContext(null);
	await f.open();
	await attached();
	const previous = current();
	const updateId = `update-${f.contexts.length}`;
	f.companion.syncContext(null);
	expect(element("remove-context").hidden).toBeTrue();
	f.companion.syncContext({ ...previous, updateId });
	f.clickPage(childId);
	await waitFor(() => expect(current()?.view?.pageId).toBe(childId));
	expect(current()?.page).toBeUndefined();
	expect(current()?.text).not.toContain(savedPage.markdown);
});

test("a restored host attachment survives initialization and subsequent navigation", async () => {
	f = fixture();
	await f.open();
	await attached();
	const snapshot = current();
	f.companion.dispose();
	document.body.innerHTML = template;
	f = fixture();
	f.companion.syncContext({ ...snapshot, updateId: "restored-attachment" });
	await f.open(childId);
	await waitFor(() => expect(current()?.view?.pageId).toBe(childId));
	expect(current()?.page?.pageId).toBe(pageId);
	expect(current()?.content[1]?.text).toBe(snapshot?.content[1]?.text);
});

test("removing context while a write is pending cannot resurrect its attached content", async () => {
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
	element("use-context").click();
	await waitFor(() =>
		expect(received.at(-1)?.structuredContent.haunterPage?.pageId).toBe(pageId),
	);
	await waitFor(() =>
		expect(element<HTMLButtonElement>("home").disabled).toBeFalse(),
	);
	block = true;
	f.emit("haunter/editor/metadata", { title: "Pending metadata", icon: null });
	await waitFor(() =>
		expect(received.at(-1)?.structuredContent.haunterView?.title).toBe(
			"Pending metadata",
		),
	);
	f.companion.syncContext(null);
	block = false;
	release();
	await waitFor(() =>
		expect(received.at(-1)?.structuredContent.haunterPage).toBeNull(),
	);
	expect(received.at(-1)?.structuredContent.haunterView?.pageId).toBe(pageId);
	expect(received.at(-1)?.content).toHaveLength(1);
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
		expect(element("context-help").textContent).toContain("could not sync"),
	);
	expect(f.frame.hidden).toBeFalse();
	fail = false;
	f.clickPage(childId);
	await waitFor(() =>
		expect(received.at(-1)?.structuredContent.haunterView?.pageId).toBe(
			childId,
		),
	);
	expect(element("context-help").textContent).not.toContain("could not sync");
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

test("teardown clears the live view, preserves attachments and ignores late editor events", async () => {
	f = fixture();
	await f.open();
	await attached();
	f.settings.saved = false;
	await expect(f.companion.prepareClose()).rejects.toThrow(
		"Keep this page open",
	);
	expect(current()?.view?.pageId).toBe(pageId);
	f.settings.saved = true;
	await f.companion.prepareClose();
	expect(current()?.view).toBeUndefined();
	expect(current()?.page?.pageId).toBe(pageId);
	f.emit("haunter/editor/save-status", { status: "saved" });
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(current()?.view).toBeUndefined();
});

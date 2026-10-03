import { afterEach, beforeEach, expect, test } from "bun:test";
import { waitFor } from "@testing-library/react";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import { validateEditorOutput } from "../mcp-app/editor-schema";
import {
	childId,
	destination,
	element,
	fixture,
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

test("editor destinations reject scripts, another origin, or a different page path", () => {
	const output = destination();
	expect(validateEditorOutput(output)).toEqual(output);
	for (const changed of [
		{ editorUrl: "javascript:alert(1)" },
		{ editorUrl: output.editorUrl.replace("haunter.test", "other.test") },
		{ editorUrl: `${output.editorUrl}?page=another` },
		{ webUrl: "https://haunter.test/settings" },
		{
			editorUrl: output.editorUrl.replace("https:", "http:"),
			webUrl: output.webUrl.replace("https:", "http:"),
		},
	])
		expect(() => validateEditorOutput({ ...output, ...changed })).toThrow();
});

test("only the active frame, origin, and nonce can enable the editor or share a selection", async () => {
	f = fixture();
	f.settings.autoReady = false;
	await f.open();
	f.emit(
		"haunter/editor/status",
		{ status: "ready" },
		{ origin: "https://other.test" },
	);
	f.emit("haunter/editor/status", { status: "ready", nonce: "stale" });
	f.emit("haunter/editor/status", { status: "ready" }, { source: window });
	expect(element<HTMLButtonElement>("use-context").disabled).toBeTrue();
	f.emit("haunter/editor/status", { status: "ready" });
	expect(element<HTMLButtonElement>("use-context").disabled).toBeFalse();
	f.emit("haunter/editor/selection", { text: "Selected live text." });
	await waitFor(() => expect(f.contexts).toHaveLength(1));
	expect(f.calls.filter((call) => call.name === "read_page")).toHaveLength(1);
	expect(f.contexts[0]?.text).toContain(
		"may include changes that have not been saved yet",
	);
	element("remove-context").click();
	await waitFor(() => expect(f.contexts.at(-1)?.text).toBe(""));
});

test("failed and stale save receipts cannot discard edits; successful switching rotates the nonce", async () => {
	f = fixture();
	await f.open();
	f.settings.autoFlush = false;
	const original = f.frame.src;
	element("home").click();
	const first = f.messages.at(-1);
	f.emit("haunter/editor/flushed", {
		requestId: first?.requestId,
		locallySaved: false,
		saved: false,
	});
	await waitFor(() =>
		expect(element("page-status").textContent).toContain("Keep this page open"),
	);
	expect(f.frame.src).toBe(original);
	f.clickPage(childId);
	await waitFor(() =>
		expect(f.messages.at(-1)?.type).toBe("haunter/editor/flush"),
	);
	const next = f.messages.at(-1);
	f.emit("haunter/editor/flushed", {
		requestId: first?.requestId,
		locallySaved: true,
		saved: true,
	});
	expect(f.frame.src).toBe(original);
	f.emit("haunter/editor/flushed", {
		requestId: next?.requestId,
		locallySaved: true,
		saved: true,
	});
	await waitFor(() => expect(f.frame.src).toContain(childId));
	expect(new URL(f.frame.src).searchParams.get("nonce")).not.toBe(
		new URL(original).searchParams.get("nonce"),
	);
});

test("a late authorization handoff cannot be delivered to a different page", async () => {
	let authorize: (data: unknown) => void = () => {};
	f = fixture({
		async callTool(name, args) {
			return name === "authorize_haunter_editor"
				? new Promise((resolve) => {
						authorize = resolve;
					})
				: f.defaultCall(name, args);
		},
	});
	await f.open();
	f.emit("haunter/editor/authorize", {
		requestId: crypto.randomUUID(),
		challenge: "a".repeat(43),
	});
	f.clickPage(childId);
	await waitFor(() => expect(f.frame.src).toContain(childId));
	authorize({ id: "old-handoff" });
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(
		f.messages.filter(
			(message) => message.type === "haunter/editor/authorized",
		),
	).toEqual([]);
});

test("missing authorization is visible and Open in Haunter uses the validated destination", async () => {
	f = fixture();
	await f.open();
	f.emit("haunter/editor/status", { status: "sign-in-required" });
	expect(element("page-status").textContent).toContain("Reconnect Haunter");
	expect(element<HTMLButtonElement>("use-context").disabled).toBeTrue();
	f.emit("haunter/editor/open-web");
	await waitFor(() => expect(f.links).toEqual([destination().webUrl]));
});

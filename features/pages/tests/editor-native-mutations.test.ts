import { afterEach, beforeEach, expect, test } from "bun:test";
import type { NodeView, ViewMutationRecord } from "@tiptap/pm/view";
// This is a regression test for our version-pinned dependency patch. BlockNote
// does not expose its node-view mutation filter through the public package API.
import { ignoreNonContentMutations } from "../../../node_modules/@blocknote/core/src/schema/nodeViewMutations";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";

beforeEach(installTestDom);
afterEach(async () => {
	document.body.replaceChildren();
	await uninstallTestDom();
});

test("both patched BlockNote bundles remain valid JavaScript", async () => {
	const entry = import.meta.resolve("@blocknote/core");
	const transpiler = new Bun.Transpiler({ loader: "js" });
	for (const filename of ["blocks-CzQLehlc.js", "blocks-CzkqclGj.cjs"]) {
		const source = await Bun.file(new URL(filename, entry)).text();
		expect(() => transpiler.transformSync(source)).not.toThrow();
	}
});

function fixture(originalIgnoreMutation?: NodeView["ignoreMutation"]) {
	const editor = document.createElement("div");
	editor.contentEditable = "true";
	const dom = document.createElement("div");
	const header = document.createElement("div");
	header.contentEditable = "false";
	const pre = document.createElement("pre");
	const contentDOM = document.createElement("code");
	contentDOM.textContent = "const first = 1;";
	pre.append(contentDOM);
	dom.append(header, pre);
	editor.append(dom);
	document.body.append(editor);
	const view: NodeView = {
		dom,
		contentDOM,
		ignoreMutation: originalIgnoreMutation,
	};
	ignoreNonContentMutations(view);
	return { dom, header, pre, contentDOM, view };
}

function childList(
	target: Node,
	addedNodes: Node[] = [],
	removedNodes: Node[] = [],
) {
	return {
		type: "childList",
		target,
		addedNodes,
		removedNodes,
	} as unknown as ViewMutationRecord;
}

test("reads a replaced inline code element instead of silently losing its text", () => {
	const { pre, contentDOM, view } = fixture(() => true);
	const replacement = document.createElement("code");
	replacement.textContent = "const second = 2;";
	contentDOM.replaceWith(replacement);
	expect(
		view.ignoreMutation?.(childList(pre, [replacement], [contentDOM])),
	).toBe(false);
});

test("reads replacement of an ancestor containing the inline code element", () => {
	const { dom, pre, view } = fixture(() => true);
	const replacement = pre.cloneNode(true);
	pre.replaceWith(replacement);
	expect(view.ignoreMutation?.(childList(dom, [replacement], [pre]))).toBe(
		false,
	);
});

test("reads each native paragraph split immediately, even outside contentDOM", () => {
	const { dom, view } = fixture(() => true);
	for (let press = 0; press < 5; press++) {
		const paragraph = document.createElement("p");
		paragraph.append(document.createElement("br"));
		dom.append(paragraph);
		window.getSelection()?.collapse(paragraph, 0);
		expect(view.ignoreMutation?.(childList(dom, [paragraph]))).toBe(false);
	}
});

test("reads a Safari code-line split when the caret moves into the new pre", () => {
	const { dom, pre, view } = fixture();
	const newLine = pre.cloneNode(true) as HTMLElement;
	dom.append(newLine);
	window
		.getSelection()
		?.collapse(newLine.querySelector("code")?.firstChild ?? newLine, 0);
	expect(view.ignoreMutation?.(childList(dom, [newLine]))).toBe(false);
});

test("keeps unrelated inserted UI ignored when the caret stays in the code", () => {
	const { dom, contentDOM, view } = fixture();
	window.getSelection()?.collapse(contentDOM.firstChild, 1);
	const chrome = document.createElement("div");
	dom.append(chrome);
	expect(view.ignoreMutation?.(childList(dom, [chrome]))).toBe(true);
});

test("ignores React reparenting the existing content DOM within its node view", () => {
	const { dom, pre, contentDOM, view } = fixture(() => true);
	const wrapper = document.createElement("div");
	dom.append(wrapper);
	wrapper.append(contentDOM);
	window.getSelection()?.collapse(contentDOM.firstChild, 1);
	expect(view.ignoreMutation?.(childList(pre, [], [contentDOM]))).toBe(true);
	expect(view.ignoreMutation?.(childList(wrapper, [contentDOM]))).toBe(true);
	expect(view.ignoreMutation?.(childList(dom, [wrapper]))).toBe(true);
});

test("ignores header changes even when their text is selected", () => {
	const { dom, header, view } = fixture();
	const label = document.createElement("span");
	label.textContent = "JavaScript";
	header.append(label);
	window.getSelection()?.collapse(label.firstChild, 1);
	expect(view.ignoreMutation?.(childList(dom, [header]))).toBe(true);
	expect(view.ignoreMutation?.(childList(header, [label]))).toBe(true);
});

test("ignores syntax highlighting and browser-extension attribute changes", () => {
	const { contentDOM, view } = fixture();
	const span = document.createElement("span");
	contentDOM.append(span);
	expect(
		view.ignoreMutation?.({
			type: "attributes",
			target: span,
		} as unknown as MutationRecord),
	).toBe(true);
});

test("preserves the node view's own filter for changes within its content", () => {
	const { contentDOM, view } = fixture(() => true);
	const text = document.createTextNode("another line");
	contentDOM.append(text);
	window.getSelection()?.collapse(text, 1);
	expect(view.ignoreMutation?.(childList(contentDOM, [text]))).toBe(true);
});

test("continues reading ordinary typing and selection changes", () => {
	const { contentDOM, view } = fixture();
	expect(
		view.ignoreMutation?.({
			type: "characterData",
			target: contentDOM.firstChild,
		} as unknown as MutationRecord),
	).toBe(false);
	expect(view.ignoreMutation?.({ type: "selection", target: contentDOM })).toBe(
		false,
	);
});

test("does not opt read-only content into native sibling mutations", () => {
	const { dom, pre, view } = fixture();
	dom.contentEditable = "false";
	const newLine = pre.cloneNode(true) as HTMLElement;
	dom.append(newLine);
	window
		.getSelection()
		?.collapse(newLine.querySelector("code")?.firstChild ?? newLine, 0);
	expect(view.ignoreMutation?.(childList(dom, [newLine]))).toBe(true);
});

import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import type { BlockNoteEditor as Editor } from "@blocknote/core";
import { AllSelection, NodeSelection, TextSelection } from "prosemirror-state";
import { CellSelection } from "prosemirror-tables";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import { LiveContextTracker } from "@/features/live-context/client/tracker";
import {
	PageSelectionSchema,
	PublishContextInputSchema,
	type PublishContextInput,
} from "@/features/live-context/schemas";
import { readPageSelection } from "../client/selection-context";
import { observePageContext } from "../client/live-context";

let BlockNoteEditor: typeof import("@blocknote/core").BlockNoteEditor;
const editors: Editor[] = [];
const cleanups: (() => void)[] = [];
beforeAll(async () => {
	installTestDom();
	const view = await import("prosemirror-view");
	mock.module("@tiptap/pm/view", () => view);
	({ BlockNoteEditor } = await import("@blocknote/core"));
});
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	for (const editor of editors.splice(0)) editor._tiptapEditor.destroy();
	document.body.replaceChildren();
});
afterAll(uninstallTestDom);

function create(
	initialContent: NonNullable<
		Parameters<typeof BlockNoteEditor.create>[0]
	>["initialContent"],
	mount = true,
) {
	const editor = BlockNoteEditor.create({ initialContent });
	editors.push(editor);
	const container = document.createElement("div");
	document.body.append(container);
	if (mount) editor.mount(container);
	return editor;
}
function start(editor: Editor, id: string) {
	let result = -1;
	editor.prosemirrorState.doc.descendants((node, pos) => {
		if (node.attrs.id === id) result = pos + 2;
	});
	if (result < 0) throw new Error("Missing block: " + id);
	return result;
}
function select(editor: Editor, anchor: number, head = anchor) {
	const { state } = editor.prosemirrorView;
	editor.prosemirrorView.dispatch(
		state.tr.setSelection(TextSelection.create(state.doc, anchor, head)),
	);
}
function read(editor: Editor) {
	return PageSelectionSchema.parse(readPageSelection(editor.prosemirrorState));
}

test("reports forward/backward multi-block ranges and a caret without selecting its entire block", () => {
	const editor = create([
		{ id: "a", type: "paragraph", content: "Hello world" },
		{ id: "b", type: "heading", content: "Second line" },
	]);
	const a = start(editor, "a") + 6,
		b = start(editor, "b") + 6;
	const original = editor.prosemirrorState.doc;
	for (const [anchor, head, activeBlockId] of [
		[a, b, "b"],
		[b, a, "a"],
	] as const) {
		select(editor, anchor, head);
		expect(read(editor)).toEqual({
			activeBlockId,
			selectedBlockIds: ["a", "b"],
			selectionCount: 2,
			selection: {
				coordinateSystem: "prosemirror",
				kind: "text",
				anchor,
				head,
				from: a,
				to: b,
				selectedText: "world\nSecond",
				truncated: false,
			},
		});
	}
	select(editor, b);
	expect(read(editor)).toMatchObject({
		activeBlockId: "b",
		selectedBlockIds: [],
		selectionCount: 0,
		selection: { from: b, to: b, selectedText: "", truncated: false },
	});
	expect(editor.prosemirrorState.doc).toBe(original);
});

test("selecting nested children does not select their parent's unrelated text", () => {
	const editor = create([
		{
			id: "parent",
			type: "bulletListItem",
			content: "Parent",
			children: [
				{ id: "child-a", type: "bulletListItem", content: "Child A" },
				{ id: "child-b", type: "bulletListItem", content: "Child B" },
			],
		},
		{ id: "after", type: "paragraph", content: "After" },
	]);
	select(editor, start(editor, "child-a"), start(editor, "child-b") + 7);
	expect(read(editor)).toMatchObject({
		activeBlockId: "child-b",
		selectedBlockIds: ["child-a", "child-b"],
		selectionCount: 2,
		selection: { selectedText: "Child A\nChild B" },
	});
});

test("node selections report block IDs without a fabricated text range", () => {
	const editor = create(
		[
			{ id: "a", type: "paragraph", content: "First" },
			{ id: "image", type: "image", props: { url: "" } },
			{ id: "b", type: "paragraph", content: "Last" },
		],
		false,
	);
	const state = editor.prosemirrorState;
	const node = state.apply(
		state.tr.setSelection(
			NodeSelection.create(state.doc, start(editor, "image") - 1),
		),
	);
	expect(readPageSelection(node)).toEqual({
		activeBlockId: "image",
		selectedBlockIds: ["image"],
		selectionCount: 1,
		selection: null,
	});
});

test("rectangular table selections identify the table without reporting unselected cells as text", () => {
	const editor = create(
		[
			{
				id: "table",
				type: "table",
				content: {
					type: "tableContent",
					rows: [{ cells: ["A", "B"] }, { cells: ["C", "D"] }],
				},
			},
		],
		false,
	);
	const state = editor.prosemirrorState;
	const cells: number[] = [];
	state.doc.descendants((node, pos) => {
		if (node.type.spec.tableRole === "cell") cells.push(pos);
	});
	expect(cells).toHaveLength(4);
	const selected = state.apply(
		state.tr.setSelection(CellSelection.create(state.doc, cells[0], cells[2])),
	);
	expect(readPageSelection(selected)).toEqual({
		activeBlockId: "table",
		selectedBlockIds: ["table"],
		selectionCount: 1,
		selection: null,
	});
});

test("all selections bound IDs and text without splitting an emoji or shrinking the coordinates", () => {
	const editor = create(
		Array.from({ length: 101 }, (_, i) => ({
			id: "block-" + i,
			type: "paragraph" as const,
			content: i === 0 ? "x".repeat(1999) + "😺more" : "next",
		})),
	);
	const view = editor.prosemirrorView;
	view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
	const context = read(editor);
	expect(context.activeBlockId).toBeNull();
	expect(context.selectedBlockIds).toHaveLength(100);
	expect(context.selectionCount).toBe(101);
	expect(context.selection).toMatchObject({
		kind: "all",
		from: 0,
		to: view.state.doc.content.size,
		selectedText: "x".repeat(1999),
		truncated: true,
	});
});

test("hard breaks and emoji retain document coordinates", () => {
	const editor = create([
		{ id: "a", type: "paragraph", content: "First\nSecond 😺" },
	]);
	const from = start(editor, "a"),
		to = from + 15;
	select(editor, from, to);
	expect(read(editor).selection).toMatchObject({
		from,
		to,
		selectedText: "First\nSecond 😺",
		truncated: false,
	});
});

test("observer retains blur context, follows edits, ignores nested canvases and never revives cleared context", async () => {
	const editor = create([
		{ id: "a", type: "paragraph", content: "Hello world" },
	]);
	const pageId = crypto.randomUUID();
	const calls: PublishContextInput[] = [];
	const tracker = new LiveContextTracker("user", async (input) => {
		calls.push(PublishContextInputSchema.parse(input));
	});
	tracker.navigate({ workspaceId: "workspace", pageId, canvasId: null });
	const observe = () =>
		observePageContext(editor, tracker, { workspaceId: "workspace", pageId });
	let stop = observe();
	cleanups.push(() => stop());
	select(editor, start(editor, "a"), start(editor, "a") + 5);
	await tracker.flush();
	expect(calls.at(-1)?.view?.pageSelection).toBeNull();
	editor.domElement!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
	await tracker.flush();
	expect(calls.at(-1)?.view?.pageSelection?.selection?.selectedText).toBe(
		"Hello",
	);
	tracker.presence(false, false);
	await tracker.flush();
	expect(calls.at(-1)?.view?.pageSelection?.selection?.selectedText).toBe(
		"Hello",
	);
	editor.prosemirrorView.dispatch(editor.prosemirrorState.tr.insertText("New"));
	await tracker.flush();
	expect(calls.at(-1)?.view?.pageSelection?.selection?.selectedText).toBe("");
	tracker.clearPage();
	select(editor, start(editor, "a"));
	stop();
	stop = observe();
	const canvas = document.createElement("div");
	canvas.dataset.liveContextCanvas = crypto.randomUUID();
	editor.domElement!.append(canvas);
	canvas.dispatchEvent(new Event("pointerdown", { bubbles: true }));
	await tracker.flush();
	expect(calls.at(-1)?.view?.pageSelection).toBeNull();
	canvas.remove();
	editor.domElement!.dispatchEvent(new Event("focusin", { bubbles: true }));
	await tracker.flush();
	expect(calls.at(-1)?.view?.pageSelection?.activeBlockId).toBe("a");
	editor.unmount();
	await tracker.flush();
	expect(calls.at(-1)?.view?.pageSelection).toBeNull();
});

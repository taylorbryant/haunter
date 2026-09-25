import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Editor, TiptapEditor, TLShapeId, TLPageId } from "tldraw";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import { LiveContextTracker } from "@/features/live-context/client/tracker";
import {
	LIVE_CONTEXT_MAX_SELECTED_TEXT,
	PublishContextInputSchema,
	type PublishContextInput,
} from "@/features/live-context/schemas";
import { normalizeCanvasSnapshot } from "../lib/document";

let editor: Editor;
let tracker: LiveContextTracker;
let calls: PublishContextInput[];
let textEditors: TiptapEditor[];
let stop: () => void;
let now: number;
const canvasId = crypto.randomUUID();
const a = "shape:a" as TLShapeId;
const b = "shape:b" as TLShapeId;
const richText = {
	type: "doc",
	content: [
		{
			type: "paragraph",
			content: [
				{ type: "text", text: "Hi " },
				{ type: "text", text: "😺 team", marks: [{ type: "bold" }] },
				{ type: "hardBreak" },
				{ type: "text", text: "again" },
			],
		},
		{ type: "paragraph", content: [{ type: "text", text: "Next" }] },
	],
};

beforeEach(async () => {
	installTestDom();
	textEditors = [];
	stop = () => {};
	const {
		Editor,
		createTLStore,
		defaultShapeUtils,
		defaultBindingUtils,
		tipTapDefaultExtensions,
	} = await import("tldraw");
	const { observeCanvasContext } = await import("../client/live-context");
	const container = document.createElement("div");
	document.body.append(container);
	editor = new Editor({
		store: createTLStore({
			shapeUtils: defaultShapeUtils,
			bindingUtils: defaultBindingUtils,
			snapshot: normalizeCanvasSnapshot({}),
		}),
		shapeUtils: defaultShapeUtils,
		bindingUtils: defaultBindingUtils,
		tools: [],
		options: {
			text: { tipTapConfig: { extensions: tipTapDefaultExtensions } },
		},
		getContainer: () => container,
	});
	editor.createShapes([
		{ id: a, type: "text", props: { richText } },
		{ id: b, type: "geo", props: { richText } },
	]);
	calls = [];
	now = 1000;
	tracker = new LiveContextTracker(
		"user",
		async (input) => {
			calls.push(PublishContextInputSchema.parse(input));
		},
		() => now,
	);
	tracker.navigate({ workspaceId: "workspace", pageId: null, canvasId });
	stop = observeCanvasContext(editor, tracker, {
		workspaceId: "workspace",
		pageId: null,
		canvasId,
	});
});
afterEach(async () => {
	stop();
	for (const textEditor of textEditors) textEditor.destroy();
	editor.dispose();
	await uninstallTestDom();
});

async function edit(shapeId = a) {
	const { Editor: TextEditor } = await import("@tiptap/core");
	const { tipTapDefaultExtensions } = await import("tldraw");
	editor.setEditingShape(shapeId);
	const textEditor = new TextEditor({
		element: document.createElement("div"),
		enableCoreExtensions: { textDirection: false },
		extensions: tipTapDefaultExtensions,
		content: richText,
	});
	textEditors.push(textEditor);
	editor.setRichTextEditor(textEditor);
	return textEditor;
}
async function context() {
	await tracker.flush();
	return calls.at(-1)!.view!.canvas!.textEditing;
}

test("reports native rich text ranges, backwards emoji selections, caret moves and text transactions", async () => {
	const text = await edit();
	text.commands.setTextSelection({ from: 1, to: 23 });
	expect(await context()).toEqual({
		shapeId: a,
		selection: {
			coordinateSystem: "prosemirror",
			kind: "text",
			anchor: 1,
			head: 23,
			from: 1,
			to: 23,
			selectedText: "Hi 😺 team\nagain\nNext",
			truncated: false,
		},
	});
	text.commands.setTextSelection({ from: 6, to: 4 });
	expect((await context())?.selection).toMatchObject({
		anchor: 6,
		head: 4,
		from: 4,
		to: 6,
		selectedText: "😺",
	});
	text.commands.setTextSelection(4);
	expect((await context())?.selection).toMatchObject({
		anchor: 4,
		head: 4,
		selectedText: "",
		truncated: false,
	});
	text.commands.insertContent("cat");
	expect((await context())?.selection).toMatchObject({
		anchor: 7,
		head: 7,
		selectedText: "",
	});
	text.commands.selectAll();
	expect((await context())?.selection).toMatchObject({
		kind: "all",
		selectedText: "Hi cat😺 team\nagain\nNext",
	});
});

test("retains text selection and its capture age across blur and heartbeats", async () => {
	const text = await edit();
	text.commands.setTextSelection({ from: 1, to: 4 });
	const before = await context();
	now += 12_000;
	editor.blur();
	tracker.presence(false, false);
	tracker.heartbeat();
	expect(await context()).toEqual(before);
	expect(calls.at(-1)?.contextAgeMs).toBe(12_000);
});

test("clears old ranges while switching editors, ending edits, changing pages and cleaning up", async () => {
	const first = await edit();
	first.commands.selectAll();
	await context();
	editor.setEditingShape(b);
	expect(await context()).toEqual({ shapeId: b, selection: null });
	const second = await edit(b);
	second.commands.setTextSelection(2);
	expect((await context())?.shapeId).toBe(b);
	const count = calls.length;
	first.commands.setTextSelection(1);
	await tracker.flush();
	expect(calls).toHaveLength(count);
	second.destroy();
	expect(await context()).toEqual({ shapeId: b, selection: null });
	editor.setEditingShape(null);
	expect(await context()).toBeNull();
	await edit();
	editor.createPage({ id: "page:other" as TLPageId, name: "Other" });
	editor.setCurrentPage("page:other" as TLPageId);
	expect(await context()).toBeNull();
	stop();
	await tracker.flush();
	const stoppedCount = calls.length;
	first.commands.setTextSelection(2);
	await tracker.flush();
	expect(calls).toHaveLength(stoppedCount);
});

test("bounds selected text without splitting surrogate pairs and does not invent unsupported ranges", async () => {
	const text = await edit();
	const prefix = "a".repeat(LIVE_CONTEXT_MAX_SELECTED_TEXT - 1);
	text.commands.setContent({
		type: "doc",
		content: [
			{
				type: "paragraph",
				content: [{ type: "text", text: prefix + "😺 tail" }],
			},
		],
	});
	text.commands.selectAll();
	expect((await context())?.selection).toMatchObject({
		selectedText: prefix,
		truncated: true,
	});
	const { NodeSelection } = await import("@tiptap/pm/state");
	text.view.dispatch(
		text.state.tr.setSelection(NodeSelection.create(text.state.doc, 0)),
	);
	expect(await context()).toEqual({ shapeId: a, selection: null });
	editor.deleteShape(a);
	expect(await context()).toBeNull();
});

import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import type { BlockNoteEditor as BlockNoteEditorType } from "@blocknote/core";
import { act, within } from "@testing-library/react/pure";
import userEvent from "@testing-library/user-event";
import * as Y from "yjs";
import { PAGE_BODY_FRAGMENT } from "@/features/documents/model";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";

type EditorSchemaModule = typeof import("../components/editor/schema");
type Editor = BlockNoteEditorType<
	EditorSchemaModule["editorSchema"]["blockSchema"],
	EditorSchemaModule["editorSchema"]["inlineContentSchema"]
>;
let BlockNoteEditor: typeof import("@blocknote/core").BlockNoteEditor;
let blocksToYDoc: typeof import("@blocknote/core/yjs").blocksToYDoc;
let withCollaboration: typeof import("@blocknote/core/yjs").withCollaboration;
let editorSchema: EditorSchemaModule["editorSchema"];
const editors: Editor[] = [];
const docs: Y.Doc[] = [];

beforeAll(async () => {
	installTestDom();
	// Happy DOM has no layout hit testing for BlockNote's hover side menu.
	document.elementsFromPoint = () => [];
	// Match next.config.js: the editor and its plugins must share the same
	// ProseMirror view classes instead of Bun's nested dependency copies.
	const view = await import("prosemirror-view");
	mock.module("@tiptap/pm/view", () => view);
	({ BlockNoteEditor } = await import("@blocknote/core"));
	({ blocksToYDoc, withCollaboration } = await import("@blocknote/core/yjs"));
	({ editorSchema } = await import("../components/editor/schema"));
});

afterEach(async () => {
	await act(async () => {
		for (const editor of editors.splice(0)) editor._tiptapEditor.destroy();
	});
	for (const doc of docs.splice(0)) doc.destroy();
	document.body.replaceChildren();
});
afterAll(uninstallTestDom);

function mountEditor(editor: Editor) {
	editors.push(editor);
	const container = document.createElement("div");
	document.body.append(container);
	editor.mount(container);
	return container;
}

function typeText(editor: Editor, text: string) {
	for (const character of text) {
		const view = editor.prosemirrorView;
		const { from, to } = view.state.selection;
		const insert = () => view.state.tr.insertText(character, from, to);
		const handled = view.someProp("handleTextInput", (handler) =>
			handler(view, from, to, character, insert),
		);
		if (!handled) view.dispatch(insert());
	}
}

function pressEnter(editor: Editor) {
	const view = editor.prosemirrorView;
	view.someProp("handleKeyDown", (handler) =>
		handler(view, new KeyboardEvent("keydown", { key: "Enter" })),
	);
}

function reopenDocument(source: Y.Doc) {
	const doc = new Y.Doc();
	docs.push(doc);
	Y.applyUpdate(doc, Y.encodeStateAsUpdate(source));
	const editor = BlockNoteEditor.create(
		withCollaboration({
			schema: editorSchema,
			collaboration: {
				fragment: doc.getXmlFragment(PAGE_BODY_FRAGMENT),
				user: { name: "Test", color: "#a78bfa" },
			},
		}),
	);
	return { doc, editor, container: mountEditor(editor) };
}

async function mountCodeMenuEditor(onlyCode = false) {
	const editor = BlockNoteEditor.create({
		schema: editorSchema,
		initialContent: [
			{ id: "code", type: "codeBlock", content: "SELECT 1;\nSELECT 2;" },
			...(onlyCode
				? []
				: [
						{ id: "following", type: "paragraph" as const, content: "Keep me" },
					]),
		],
	});
	await act(async () => {
		mountEditor(editor);
	});
	const user = userEvent.setup({ document });
	return { editor, user, ui: within(document.body) };
}

test("code menu deletes its whole block, preserves other selected blocks, and supports undo", async () => {
	const { editor, user, ui } = await mountCodeMenuEditor();
	const before = editor.document;
	editor.setSelection("code", "following");
	await user.click(ui.getByRole("button", { name: "Code block options" }));
	await user.click(ui.getByRole("menuitem", { name: "Delete" }));
	expect(editor.getBlock("code")).toBeUndefined();
	expect(editor.getBlock("following")).toEqual(before[1]);
	expect(ui.queryByRole("menu")).toBeNull();
	await act(async () => {
		editor.undo();
	});
	expect(editor.document).toEqual(before);
});

test("deleting the last code block leaves an editable paragraph", async () => {
	const { editor, user, ui } = await mountCodeMenuEditor(true);
	await user.click(ui.getByRole("button", { name: "Code block options" }));
	await user.click(ui.getByRole("menuitem", { name: "Delete" }));
	expect(editor.getBlock("code")).toBeUndefined();
	expect(editor.document[0]?.type).toBe("paragraph");
	typeText(editor, "New text");
	expect(editor.document[0]?.content).toEqual([
		{ type: "text", text: "New text", styles: {} },
	]);
});

test("code options support keyboard dismissal and disappear when editing is disabled", async () => {
	const { editor, user, ui } = await mountCodeMenuEditor();
	const trigger = ui.getByRole("button", { name: "Code block options" });
	trigger.focus();
	await user.keyboard("{Enter}");
	expect(ui.getByRole("menuitem", { name: "Delete" })).toBeDefined();
	await user.keyboard("{Escape}");
	expect(ui.queryByRole("menu")).toBeNull();
	expect(document.activeElement).toBe(trigger);
	await user.click(trigger);
	await act(async () => {
		editor.isEditable = false;
	});
	expect(ui.queryByRole("menu")).toBeNull();
	expect(ui.queryByRole("button", { name: "Code block options" })).toBeNull();
	expect(editor.getBlock("code")).toBeDefined();
	expect(ui.getByRole("button", { name: "Expand code" })).toBeDefined();
	await act(async () => {
		editor.isEditable = true;
	});
	expect(ui.getByRole("button", { name: "Code block options" })).toBeDefined();
});

test("removing a code block elsewhere cleans up its open menu", async () => {
	const { editor, user, ui } = await mountCodeMenuEditor();
	await user.click(ui.getByRole("button", { name: "Code block options" }));
	expect(ui.getByRole("menuitem", { name: "Delete" })).toBeDefined();
	await act(async () => {
		editor.removeBlocks(["code"]);
	});
	expect(ui.queryByRole("menu")).toBeNull();
	expect(editor.getBlock("following")).toBeDefined();
});

test.each([
	["", "text"],
	["bash", "shellscript"],
	["TS", "typescript"],
	["bash```", "text"],
	["unknown-language", "text"],
])("code fence %p stays editable with Space and Enter", (label, language) => {
	for (const trigger of ["space", "enter"]) {
		const editor = BlockNoteEditor.create({
			schema: editorSchema,
			initialContent: [
				{ id: "fence", type: "paragraph", content: "" },
				{ id: "following", type: "paragraph", content: "Keep this text" },
			],
		});
		const container = mountEditor(editor);
		editor.setTextCursorPosition("fence", "start");
		typeText(editor, `\`\`\`${label}`);
		if (trigger === "space") typeText(editor, " ");
		else pressEnter(editor);
		expect(editor.getBlock("fence")).toMatchObject({
			type: "codeBlock",
			props: { language },
			content: [],
		});
		expect(container.querySelector("select")?.value).toBe(language);
		typeText(editor, "echo hello");
		expect(editor.getBlock("fence")?.content).toEqual([
			{ type: "text", text: "echo hello", styles: {} },
		]);
		editor.setTextCursorPosition("following", "end");
		typeText(editor, " too");
		expect(editor.getBlock("following")?.content).toEqual([
			{ type: "text", text: "Keep this text too", styles: {} },
		]);
	}
});

test("fences wait for a delimiter and stay literal inside code", () => {
	const editor = BlockNoteEditor.create({
		schema: editorSchema,
		initialContent: [{ id: "fence", type: "paragraph", content: "" }],
	});
	mountEditor(editor);
	editor.setTextCursorPosition("fence", "start");
	typeText(editor, "```bash");
	expect(editor.getBlock("fence")?.type).toBe("paragraph");
	pressEnter(editor);
	typeText(editor, "```js");
	pressEnter(editor);
	expect(editor.getBlock("fence")).toMatchObject({
		type: "codeBlock",
		props: { language: "shellscript" },
		content: [{ type: "text", text: "```js\n", styles: {} }],
	});
});

test.each(["", "bash", "bash```", "unknown-language"])(
	"reopens a saved collaborative code block with language %p",
	(language) => {
		// Bypass JSON normalization, as an older client can persist these props
		// directly into the collaborative document.
		const sourceEditor = BlockNoteEditor.create({ schema: editorSchema });
		editors.push(sourceEditor);
		const source = blocksToYDoc(
			sourceEditor,
			[
				{
					id: "saved-code",
					type: "codeBlock",
					props: { language },
					content: "  echo hello\n\n\t# keep whitespace\n",
				},
				{ id: "following", type: "paragraph", content: "Keep this text" },
			],
			PAGE_BODY_FRAGMENT,
		);
		docs.push(source);
		const { editor, doc, container } = reopenDocument(source);
		// Rendering and highlighting must not rewrite the shared document.
		expect(editor.getBlock("saved-code")).toMatchObject({
			props: { language },
		});
		expect(container.querySelector("select")?.value).toBe(
			language === "bash" ? "shellscript" : "text",
		);
		expect(
			editorSchema.blockSpecs.codeBlock.implementation.meta?.highlight?.({
				type: "codeBlock",
				props: { language },
			}),
		).toBe(language === "bash" ? "shellscript" : "text");
		expect(editor.getBlock("saved-code")?.content).toEqual([
			{
				type: "text",
				text: "  echo hello\n\n\t# keep whitespace\n",
				styles: {},
			},
		]);
		editor.setTextCursorPosition("following", "end");
		typeText(editor, " too");
		expect(editor.getBlock("following")?.content).toEqual([
			{ type: "text", text: "Keep this text too", styles: {} },
		]);
		const reloaded = reopenDocument(doc);
		expect(reloaded.editor.document).toEqual(editor.document);
		// The recovered language picker can persist a supported replacement.
		const select = reloaded.container.querySelector("select")!;
		select.value = "sql";
		select.dispatchEvent(new Event("change"));
		expect(reloaded.editor.getBlock("saved-code")).toMatchObject({
			props: { language: "sql" },
		});
	},
);

test("an unsupported language arriving over Yjs keeps the open page editable", () => {
	const sourceEditor = BlockNoteEditor.create({ schema: editorSchema });
	editors.push(sourceEditor);
	const source = blocksToYDoc(
		sourceEditor,
		[
			{
				id: "remote-code",
				type: "codeBlock",
				props: { language: "sql" },
				content: "select 1",
			},
		],
		PAGE_BODY_FRAGMENT,
	);
	docs.push(source);
	const { doc, editor, container } = reopenDocument(source);
	const codeNode = Array.from(
		source
			.getXmlFragment(PAGE_BODY_FRAGMENT)
			.createTreeWalker(
				(node) => node instanceof Y.XmlElement && node.nodeName === "codeBlock",
			),
	)[0] as Y.XmlElement;
	codeNode.setAttribute("language", "bash```");
	Y.applyUpdate(doc, Y.encodeStateAsUpdate(source, Y.encodeStateVector(doc)));
	expect(container.querySelector("select")?.value).toBe("text");
	editor.setTextCursorPosition("remote-code", "end");
	typeText(editor, ";");
	expect(editor.getBlock("remote-code")?.content).toEqual([
		{ type: "text", text: "select 1;", styles: {} },
	]);
});

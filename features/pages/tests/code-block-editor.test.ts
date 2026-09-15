import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import type { BlockNoteEditor as BlockNoteEditorType } from "@blocknote/core";
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
	// Match next.config.js: the editor and its plugins must share the same
	// ProseMirror view classes instead of Bun's nested dependency copies.
	const view = await import("prosemirror-view");
	mock.module("@tiptap/pm/view", () => view);
	({ BlockNoteEditor } = await import("@blocknote/core"));
	({ blocksToYDoc, withCollaboration } = await import("@blocknote/core/yjs"));
	({ editorSchema } = await import("../components/editor/schema"));
});

afterEach(() => {
	for (const editor of editors.splice(0)) editor._tiptapEditor.destroy();
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

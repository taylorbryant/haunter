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
	document.elementsFromPoint = () => [];
	// Keep the editor and its plugins on the same ProseMirror view classes.
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

test.each([1, 2, 3, 4])(
	"heading %i keeps removed bold off when its rendered HTML is read back",
	(level) => {
		const editor = BlockNoteEditor.create({
			schema: editorSchema,
			initialContent: [
				{
					id: "heading",
					type: "heading",
					props: { level },
					content: [{ type: "text", text: "Heading", styles: { bold: true } }],
				},
			],
		});
		editors.push(editor);
		const container = document.createElement("div");
		document.body.append(container);
		editor.mount(container);
		editor.setTextCursorPosition("heading", "start");
		const from = editor.prosemirrorState.selection.from;
		editor._tiptapEditor.commands.setTextSelection({ from, to: from + 7 });
		editor.removeStyles({ bold: true });
		expect(editor.getActiveStyles().bold).toBeUndefined();
		const content = [{ type: "text" as const, text: "Heading", styles: {} }];
		expect(editor.document[0]?.content).toEqual(content);

		const saved = blocksToYDoc(editor, editor.document, PAGE_BODY_FRAGMENT);
		const loaded = new Y.Doc();
		docs.push(saved, loaded);
		Y.applyUpdate(loaded, Y.encodeStateAsUpdate(saved));
		const reopened = BlockNoteEditor.create(
			withCollaboration({
				schema: editorSchema,
				collaboration: {
					fragment: loaded.getXmlFragment(PAGE_BODY_FRAGMENT),
					user: { name: "Test", color: "#a78bfa" },
				},
			}),
		);
		editors.push(reopened);
		const reopenedContainer = document.createElement("div");
		document.body.append(reopenedContainer);
		reopened.mount(reopenedContainer);
		expect(reopened.document[0]?.content).toEqual(content);

		// Native editing and paste can reparse the rendered DOM. Heading
		// typography must not become an explicit inline bold mark.
		const parsed = reopened.tryParseHTMLToBlocks(reopenedContainer.innerHTML);
		expect(parsed[0]).toMatchObject({ type: "heading", props: { level } });
		expect(parsed[0]?.content).toEqual(content);
	},
);

test("heading HTML preserves intentional bold on only the selected words", () => {
	const content = [
		{ type: "text" as const, text: "Plain ", styles: {} },
		{ type: "text" as const, text: "bold", styles: { bold: true } },
		{ type: "text" as const, text: " italic", styles: { italic: true } },
	];
	const editor = BlockNoteEditor.create({
		schema: editorSchema,
		initialContent: [{ type: "heading", props: { level: 2 }, content }],
	});
	editors.push(editor);
	const container = document.createElement("div");
	document.body.append(container);
	editor.mount(container);
	expect(editor.tryParseHTMLToBlocks(container.innerHTML)[0]?.content).toEqual(
		content,
	);
});

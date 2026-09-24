import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import * as Y from "yjs";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";

beforeAll(async () => {
	installTestDom();
	// Match the app's ProseMirror view alias, as in the editor integration tests.
	const view = await import("prosemirror-view");
	mock.module("@tiptap/pm/view", () => view);
});
afterAll(uninstallTestDom);

test("native node reuse during concurrent moves is rejected without dropping another block", async () => {
	const { BlockNoteEditor } = await import("@blocknote/core");
	const { withCollaboration } = await import("@blocknote/core/yjs");
	const { serverPageSchema } = await import("@/infra/documents/page-schema");
	const { seedPageBody, projectPageBody } = await import(
		"@/infra/documents/codec"
	);
	const { editDocumentBlocks } = await import("@/infra/documents/block-edits");
	const { prepareDocumentUpdate, validateDocumentState } = await import(
		"@/infra/documents/validate-update"
	);
	const server = seedPageBody(
		["a", "b", "c"].map((id) => ({
			id,
			type: "paragraph",
			props: {},
			children: [],
			content: [{ type: "text", text: id.toUpperCase(), styles: {} }],
		})),
	);
	const client = new Y.Doc();
	Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
	const editor = BlockNoteEditor.create(
		withCollaboration({
			schema: serverPageSchema,
			collaboration: {
				fragment: client.getXmlFragment("body"),
				user: { name: "Test", color: "#a78bfa" },
			},
		}),
	);
	const container = document.createElement("div");
	document.body.append(container);
	try {
		editor.mount(container);
		editor.moveBlocksDown("a");
		expect(editor.document.map((block) => block.id)).toEqual(["b", "a", "c"]);
		editDocumentBlocks(server, [
			{ op: "move", blockId: "a", afterBlockId: "c" },
		]);
		const pending = Y.encodeStateAsUpdate(client),
			saved = Y.encodeStateAsUpdate(server);
		expect(() => prepareDocumentUpdate(server, pending)).toThrow(
			"remove other blocks",
		);
		expect(() => prepareDocumentUpdate(client, saved)).toThrow(
			"remove other blocks",
		);
		expect(Y.encodeStateAsUpdate(client)).toEqual(pending);
		expect(Y.encodeStateAsUpdate(server)).toEqual(saved);
		expect(editor.document.map((block) => block.id)).toEqual(["b", "a", "c"]);
		expect(projectPageBody(server).map((block) => block.id)).toEqual([
			"b",
			"c",
			"a",
		]);
		editor.prosemirrorState.doc.check();
		editor.updateBlock("b", { content: "Typing after the move" });
		validateDocumentState(client);
		expect(JSON.stringify(projectPageBody(client))).toContain(
			"Typing after the move",
		);
	} finally {
		editor._tiptapEditor.destroy();
		container.remove();
		client.destroy();
		server.destroy();
	}
});

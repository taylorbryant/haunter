import { expect, test } from "bun:test";
import { BlockNoteEditor } from "@blocknote/core";
import * as Y from "yjs";
import { withHaunterCollaboration } from "../components/editor/blocknote-collaboration";
import { editorSchema } from "../components/editor/schema";

test("installs BlockNote's Yjs collaboration extensions", () => {
	const doc = new Y.Doc();
	const options = withHaunterCollaboration(
		{},
		{
			fragment: doc.getXmlFragment("blocknote"),
			user: { name: "Taylor", color: "#8b5cf6" },
		},
	);

	expect(options.extensions).toHaveLength(1);
	expect(options.disableExtensions).toContain("history");
	expect(options.initialContent).toEqual([
		{ type: "paragraph", id: "initialBlockId" },
	]);
});

test("installs document sync and publishes the local cursor identity", () => {
	const doc = new Y.Doc();
	const localStateFields: Array<[string, unknown]> = [];
	const awareness = {
		getLocalState: () => null,
		getStates: () => new Map(),
		off: () => {},
		on: () => {},
		setLocalStateField: (field: string, value: unknown) => {
			localStateFields.push([field, value]);
		},
	};
	const editor = BlockNoteEditor.create(
		withHaunterCollaboration(
			{ schema: editorSchema },
			{
				fragment: doc.getXmlFragment("blocknote"),
				provider: { awareness } as never,
				user: { name: "Taylor", color: "#8b5cf6" },
			},
		),
	);

	try {
		const extensionNames = editor._tiptapEditor.extensionManager.extensions.map(
			(extension) => extension.name,
		);
		expect(extensionNames).toContain("ySync");
		expect(extensionNames).toContain("yCursor");
		expect(extensionNames).toContain("yUndo");
		expect(localStateFields).toContainEqual([
			"user",
			{ name: "Taylor", color: "#8b5cf6" },
		]);
	} finally {
		editor._tiptapEditor.destroy();
		doc.destroy();
	}
});

import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import * as Y from "yjs";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import { extractInlineText } from "@/features/content/inline-content";
import { tableCellRows } from "@/features/content/table-content";

beforeAll(async () => {
	installTestDom();
	const view = await import("prosemirror-view");
	mock.module("@tiptap/pm/view", () => view);
});
afterAll(uninstallTestDom);

const text = (value: string) => [
	{ type: "text" as const, text: value, styles: {} },
];
function tableBlock() {
	return {
		id: "table",
		type: "table",
		props: {},
		children: [],
		content: {
			type: "tableContent",
			columnWidths: [180, 240],
			headerRows: 1,
			rows: [
				{ cells: [text("Name"), text("Status")] },
				{
					cells: [
						text("Alpha"),
						{
							type: "tableCell",
							props: { backgroundColor: "yellow", textAlignment: "right" },
							content: text("Draft"),
						},
					],
				},
			],
		},
	};
}

test("native editor receives table edits and can keep typing with styles, widths, and headers intact", async () => {
	const { BlockNoteEditor } = await import("@blocknote/core");
	const { withCollaboration } = await import("@blocknote/core/yjs");
	const { serverPageSchema } = await import("@/infra/documents/page-schema");
	const { seedPageBody, projectPageBody } = await import(
		"@/infra/documents/codec"
	);
	const { editDocumentBlocks } = await import("@/infra/documents/block-edits");
	const { validateDocumentState } = await import(
		"@/infra/documents/validate-update"
	);
	const server = seedPageBody([tableBlock()]);
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
		editDocumentBlocks(server, [
			{
				op: "update_table_cell",
				blockId: "table",
				row: 1,
				column: 1,
				content: text("Ready"),
			},
			{
				op: "insert_table_row",
				blockId: "table",
				index: 1,
				cells: [text("Beta"), []],
			},
			{
				op: "insert_table_column",
				blockId: "table",
				index: 1,
				width: 120,
				cells: [text("Owner"), [], []],
			},
		]);
		Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
		expect(container.querySelectorAll("tr")).toHaveLength(3);
		expect(container.querySelectorAll("th")).toHaveLength(3);
		expect(container.querySelectorAll("td")).toHaveLength(6);
		expect(projectPageBody(client)[0]!.content).toMatchObject({
			columnWidths: [180, 120, 240],
			headerRows: 1,
			rows: [
				{},
				{},
				{
					cells: [
						{},
						{},
						{
							props: { backgroundColor: "yellow", textAlignment: "right" },
							content: text("Ready"),
						},
					],
				},
			],
		});
		editor.prosemirrorState.doc.check();
		let position = -1;
		editor.prosemirrorState.doc.descendants((node, pos) => {
			if (node.isText && node.text === "Ready") position = pos + node.nodeSize;
		});
		expect(position).toBeGreaterThan(0);
		editor.prosemirrorView.dispatch(
			editor.prosemirrorState.tr.insertText(" by human", position),
		);
		validateDocumentState(client);
		Y.applyUpdate(server, Y.encodeStateAsUpdate(client));
		expect(extractInlineText(projectPageBody(server)[0]!.content)).toContain(
			"Ready by human",
		);
		editDocumentBlocks(server, [
			{ op: "delete_table_row", blockId: "table", index: 1 },
			{ op: "delete_table_column", blockId: "table", index: 1 },
		]);
		Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
		expect(container.querySelectorAll("tr")).toHaveLength(2);
		expect(container.querySelectorAll("th")).toHaveLength(2);
		expect(extractInlineText(projectPageBody(client)[0]!.content)).toBe(
			"Name\tStatus\nAlpha\tReady by human",
		);
		editor.prosemirrorState.doc.check();
	} finally {
		editor._tiptapEditor.destroy();
		container.remove();
		client.destroy();
		server.destroy();
	}
});

test("targeted table edits preserve concurrent typing in the same cell and in another row", async () => {
	const { seedPageBody, projectPageBody } = await import(
		"@/infra/documents/codec"
	);
	const { editDocumentBlocks } = await import("@/infra/documents/block-edits");
	const { validateDocumentState } = await import(
		"@/infra/documents/validate-update"
	);
	const server = seedPageBody([tableBlock()]);
	const client = new Y.Doc();
	Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
	try {
		for (const node of client
			.getXmlFragment("body")
			.createTreeWalker(() => true)) {
			if (
				node instanceof Y.XmlText &&
				["Draft", "Name"].includes(node.toString())
			)
				node.insert(node.length, " + human");
		}
		editDocumentBlocks(server, [
			{
				op: "update_table_cell",
				blockId: "table",
				row: 1,
				column: 1,
				content: text("Ready"),
			},
			{
				op: "insert_table_row",
				blockId: "table",
				index: 1,
				cells: [text("Beta"), []],
			},
		]);
		const clientUpdate = Y.encodeStateAsUpdate(client),
			serverUpdate = Y.encodeStateAsUpdate(server);
		Y.applyUpdate(server, clientUpdate);
		Y.applyUpdate(client, serverUpdate);
		validateDocumentState(server);
		validateDocumentState(client);
		expect(projectPageBody(server)).toEqual(projectPageBody(client));
		expect(
			tableCellRows(projectPageBody(server)[0]!.content).map((row) =>
				row.map(extractInlineText),
			),
		).toEqual([
			["Name + human", "Status"],
			["Beta", ""],
			["Alpha", "Ready + human"],
		]);
	} finally {
		client.destroy();
		server.destroy();
	}
});

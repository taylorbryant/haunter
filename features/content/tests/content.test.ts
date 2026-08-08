import { describe, expect, it } from "bun:test";
import {
	containsBlockId,
	findBlockById,
	mapBlocks,
	visitBlocks,
} from "../block-tree";
import {
	extractDocumentSearchText,
	extractDocumentText,
} from "../document-text";
import { extractPageLinks } from "../page-links";
import { type BlockJson, DocumentContentSchema } from "../schemas";

const document: BlockJson[] = [
	{
		id: "heading",
		type: "heading",
		props: { level: 1 },
		content: [{ type: "text", text: "Project plan" }],
		children: [
			{
				id: "nested",
				type: "paragraph",
				props: {},
				content: [
					{
						type: "link",
						content: [{ type: "text", text: "Nested detail" }],
					},
				],
				children: [],
			},
		],
	},
];

describe("content kernel", () => {
	it("validates and defaults structural document fields", () => {
		const parsed = DocumentContentSchema.parse([
			{ id: "one", type: "paragraph" },
		]);

		expect(parsed).toEqual([
			{ id: "one", type: "paragraph", props: {}, children: [] },
		]);
	});

	it("traverses nested blocks and finds identities", () => {
		const visited: string[] = [];
		visitBlocks(document, (block) => visited.push(block.id));

		expect(visited).toEqual(["heading", "nested"]);
		expect(findBlockById(document, "nested")?.type).toBe("paragraph");
		expect(containsBlockId(document, "missing")).toBe(false);
	});

	it("maps immutably while preserving unchanged branches", () => {
		const mapped = mapBlocks(document, (block) =>
			block.id === "nested"
				? { ...block, props: { ...block.props, aligned: true } }
				: block,
		);
		const unchanged = mapBlocks(document, (block) => block);

		expect(mapped).not.toBe(document);
		expect(mapped[0]).not.toBe(document[0]);
		expect(mapped[0]?.children[0]?.props).toEqual({ aligned: true });
		expect(document[0]?.children[0]?.props).toEqual({});
		expect(unchanged[0]).toBe(document[0]);
	});

	it("extracts generic text without indexing block properties", () => {
		expect(extractDocumentText(document)).toEqual([
			{ blockId: "heading", text: "Project plan" },
			{ blockId: "nested", text: "Nested detail" },
		]);
		expect(extractDocumentSearchText(document)).toBe(
			"Project plan\nNested detail",
		);
	});

	it("extracts unique page links from blocks and nested inline mentions", () => {
		const links: BlockJson[] = [
			{
				id: "page-link",
				type: "pageLink",
				props: { pageId: "page-a" },
				children: [],
			},
			{
				id: "mentions",
				type: "paragraph",
				props: {},
				content: [
					{ type: "mention", props: { pageId: "page-b" } },
					{
						type: "link",
						content: [{ type: "mention", props: { pageId: "page-a" } }],
					},
				],
				children: [],
			},
		];

		expect(extractPageLinks(links)).toEqual(["page-a", "page-b"]);
	});
});

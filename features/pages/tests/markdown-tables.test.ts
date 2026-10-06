import { expect, test } from "bun:test";
import { extractInlineText } from "@/features/content/inline-content";
import { tableCellRows } from "@/features/content/table-content";
import { blocksToMarkdown, markdownToBlocks } from "../lib/markdown";

const nonTableBlocks = [
	{
		line: "# Status | Owner",
		type: "heading",
		text: "Status | Owner",
		props: { level: 1 },
	},
	{ line: "> Status | Owner", type: "callout", text: "Status | Owner" },
	{ line: "- Status | Owner", type: "bulletListItem", text: "Status | Owner" },
	{ line: "* Status | Owner", type: "bulletListItem", text: "Status | Owner" },
	{
		line: "1. Status | Owner",
		type: "numberedListItem",
		text: "Status | Owner",
	},
	{
		line: "2) Status | Owner",
		type: "numberedListItem",
		text: "Status | Owner",
	},
	{
		line: "- [x] Status | Owner (due: 2026-10-10)",
		type: "task",
		text: "Status | Owner",
		props: { checked: true, due: "2026-10-10" },
	},
	{
		line: "![Status | Owner](https://example.com/image.png)",
		type: "image",
		props: { caption: "Status | Owner", url: "https://example.com/image.png" },
	},
];

test.each(nonTableBlocks)(
	"preserves $type syntax before a table-like separator: $line",
	({ line, type, text, props }) => {
		const blocks = markdownToBlocks(`${line}\n--- | ---`);
		expect(blocks).toHaveLength(2);
		expect(blocks[0]).toMatchObject({ type, ...(props ? { props } : {}) });
		if (text) expect(extractInlineText(blocks[0]!.content)).toBe(text);
		expect(blocks[1]!.type).toBe("paragraph");
		expect(extractInlineText(blocks[1]!.content)).toBe("--- | ---");
	},
);

test.each(nonTableBlocks)(
	"ends a table before a following $type block: $line",
	({ line, type, text, props }) => {
		const blocks = markdownToBlocks(
			`Status | Owner\n--- | ---\nReady | Taylor\n${line}`,
		);
		expect(blocks).toHaveLength(2);
		expect(blocks[0]!.type).toBe("table");
		expect(
			tableCellRows(blocks[0]!.content).map((row) =>
				row.map(extractInlineText),
			),
		).toEqual([
			["Status", "Owner"],
			["Ready", "Taylor"],
		]);
		expect(blocks[1]).toMatchObject({ type, ...(props ? { props } : {}) });
		if (text) expect(extractInlineText(blocks[1]!.content)).toBe(text);
	},
);

test("explicit outer pipes allow block-like text inside table cells", () => {
	const blocks = markdownToBlocks(
		"| # Status | > Owner |\n| --- | --- |\n| - [ ] Ready | 1. Taylor |",
	);
	expect(blocks).toHaveLength(1);
	expect(blocks[0]!.type).toBe("table");
	expect(
		tableCellRows(blocks[0]!.content).map((row) => row.map(extractInlineText)),
	).toEqual([
		["# Status", "> Owner"],
		["- [ ] Ready", "1. Taylor"],
	]);
});

test("a code fence containing a pipe ends the preceding table", () => {
	const blocks = markdownToBlocks(
		"Status | Owner\n--- | ---\n```js|example\nconst owner = 'Taylor';\n```",
	);
	expect(blocks.map((block) => block.type)).toEqual(["table", "codeBlock"]);
	expect(tableCellRows(blocks[0]!.content)).toHaveLength(1);
	expect(extractInlineText(blocks[1]!.content)).toBe("const owner = 'Taylor';");
});

test("pipe tables parse styled cells, alignments, escaped pipes, and line breaks", () => {
	const blocks = markdownToBlocks(
		"Before\n\n| Name | Details |\n| :--- | ---: |\n| **Alpha** | `a\\|b`<br>[More](https://example.com) |\n\nAfter",
	);
	expect(blocks.map((block) => block.type)).toEqual([
		"paragraph",
		"table",
		"paragraph",
	]);
	expect(blocks[1]!.content).toMatchObject({
		type: "tableContent",
		headerRows: 1,
		rows: [
			{
				cells: [
					{ props: { textAlignment: "left" } },
					{ props: { textAlignment: "right" } },
				],
			},
			{
				cells: [
					{ content: [{ text: "Alpha", styles: { bold: true } }] },
					{
						content: [
							{ text: "a|b", styles: { code: true } },
							{ text: "\n" },
							{ type: "link", href: "https://example.com" },
						],
					},
				],
			},
		],
	});
	expect(extractInlineText(blocks[1]!.content)).toBe(
		"Name\tDetails\nAlpha\ta|b\nMore",
	);
	const roundTrip = markdownToBlocks(blocksToMarkdown(blocks));
	expect(tableCellRows(roundTrip[1]!.content)).toEqual(
		tableCellRows(blocks[1]!.content),
	);
});

test("table reads retain every data row without a native header and escape literal punctuation", () => {
	const blocks = [
		{
			id: "table",
			type: "table",
			props: {},
			children: [],
			content: {
				type: "tableContent",
				rows: [
					{
						cells: [
							[{ type: "text", text: "A\\|B", styles: {} }],
							{
								type: "tableCell",
								content: [{ type: "text", text: "C\nD", styles: {} }],
							},
						],
					},
				],
			},
		},
	];
	const markdown = blocksToMarkdown(blocks);
	expect(markdown).toStartWith("|  |  |\n| --- | --- |\n");
	expect(
		tableCellRows(markdownToBlocks(markdown)[0]!.content)[1]?.map(
			extractInlineText,
		),
	).toEqual(["A\\|B", "C\nD"]);
});

test("malformed table rows and code fences retain their content", () => {
	const malformed = markdownToBlocks(
		"| A | B |\n| --- | --- |\n| One | Two | Three |\nTail",
	);
	expect(malformed.map((block) => block.type)).toEqual([
		"table",
		"paragraph",
		"paragraph",
	]);
	expect(extractInlineText(malformed[1]!.content)).toBe(
		"| One | Two | Three |",
	);
	expect(
		markdownToBlocks("A | B\n--- | --").every(
			(block) => block.type === "paragraph",
		),
	).toBe(true);
	expect(
		markdownToBlocks("```text\n| A | B |\n| --- | --- |\n```")[0]!.type,
	).toBe("codeBlock");
	expect(markdownToBlocks("A | B\n--- | ---\nOne | Two")[0]!.type).toBe(
		"table",
	);
});

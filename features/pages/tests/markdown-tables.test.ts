import { expect, test } from "bun:test";
import { extractInlineText } from "@/features/content/inline-content";
import { tableCellRows } from "@/features/content/table-content";
import { blocksToMarkdown, markdownToBlocks } from "../lib/markdown";

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

import { describe, expect, it } from "bun:test";
import {
	blocksToMarkdown,
	markdownToBlocks,
} from "@/features/pages/lib/markdown";
import type { BlockJson } from "@/features/pages/schemas";

function block(
	type: string,
	props: Record<string, unknown>,
	text?: string,
	children: BlockJson[] = [],
): BlockJson {
	return {
		id: crypto.randomUUID(),
		type,
		props,
		content:
			text === undefined ? undefined : [{ type: "text", text, styles: {} }],
		children,
	};
}

describe("blocksToMarkdown", () => {
	it("renders the Haunter block vocabulary", () => {
		const markdown = blocksToMarkdown([
			block("heading", { level: 2 }, "Plans"),
			block("paragraph", {}, "Hello world"),
			block("task", { checked: false, due: "2026-07-10" }, "Ship it"),
			block("task", { checked: true }, "Done thing"),
			block("bulletListItem", {}, "One"),
			block("numberedListItem", {}, "First"),
			block("numberedListItem", {}, "Second"),
			block("callout", { emoji: "💡" }, "Remember"),
			block("divider", {}),
			block("codeBlock", { language: "ts" }, "const a = 1;"),
		]);

		expect(markdown).toContain("## Plans");
		expect(markdown).toContain("Hello world");
		expect(markdown).toContain("- [ ] Ship it (due: 2026-07-10)");
		expect(markdown).toContain("- [x] Done thing");
		expect(markdown).toContain("- One");
		expect(markdown).toContain("1. First");
		expect(markdown).toContain("2. Second");
		expect(markdown).toContain("> 💡 Remember");
		expect(markdown).toContain("---");
		expect(markdown).toContain("```ts\nconst a = 1;\n```");
	});

	it("renders inline styles and links", () => {
		const markdown = blocksToMarkdown([
			{
				id: "1",
				type: "paragraph",
				props: {},
				content: [
					{ type: "text", text: "bold", styles: { bold: true } },
					{ type: "text", text: " and ", styles: {} },
					{
						type: "link",
						href: "https://example.com",
						content: [{ type: "text", text: "a link", styles: {} }],
					},
				],
				children: [],
			},
		]);

		expect(markdown).toBe("**bold** and [a link](https://example.com)");
	});

	it("indents nested children under list items", () => {
		const markdown = blocksToMarkdown([
			block("bulletListItem", {}, "Parent", [
				block("bulletListItem", {}, "Child"),
			]),
		]);

		expect(markdown).toBe("- Parent\n\n  - Child");
	});
});

describe("markdownToBlocks", () => {
	it("parses the supported subset", () => {
		const blocks = markdownToBlocks(
			[
				"## Plans",
				"",
				"Hello **world**",
				"",
				"- [ ] Ship it (due: 2026-07-10)",
				"- [x] Done thing",
				"- One",
				"1. First",
				"",
				"> Remember",
				"",
				"---",
				"",
				"```ts",
				"const a = 1;",
				"```",
			].join("\n"),
		);

		const types = blocks.map((b) => b.type);
		expect(types).toEqual([
			"heading",
			"paragraph",
			"task",
			"task",
			"bulletListItem",
			"numberedListItem",
			"callout",
			"divider",
			"codeBlock",
		]);

		expect(blocks[0].props.level).toBe(2);
		expect(blocks[2].props).toMatchObject({
			checked: false,
			due: "2026-07-10",
		});
		expect(blocks[3].props.checked).toBe(true);
		expect(blocks[8].props.language).toBe("ts");
		// Every block needs a stable id for BlockNote and task reconciliation.
		for (const b of blocks) expect(b.id.length).toBeGreaterThan(0);
	});

	it("nests two-space-indented list items as children", () => {
		const blocks = markdownToBlocks("- Parent\n  - Child\n- Sibling");

		expect(blocks).toHaveLength(2);
		expect(blocks[0].children).toHaveLength(1);
		const child = blocks[0].children[0];
		expect(child.type).toBe("bulletListItem");
	});

	it("supports H4 and caps deeper markdown headings at H4", () => {
		const blocks = markdownToBlocks("#### Minor\n\n###### Too deep");

		expect(blocks[0]).toMatchObject({
			type: "heading",
			props: { level: 4 },
		});
		expect(blocks[1]).toMatchObject({
			type: "heading",
			props: { level: 4 },
		});
	});

	it("round-trips content through markdown", () => {
		const original = [
			block("heading", { level: 1 }, "Title"),
			block("task", { checked: false, due: "2026-08-01" }, "Water plants"),
			block("paragraph", {}, "Some prose"),
		];

		const reparsed = markdownToBlocks(blocksToMarkdown(original));

		expect(reparsed.map((b) => b.type)).toEqual([
			"heading",
			"task",
			"paragraph",
		]);
		expect(reparsed[1].props.due).toBe("2026-08-01");
	});

	it("parses inline styles back into styled text nodes", () => {
		const [para] = markdownToBlocks("**bold** and [a link](https://x.dev)");
		const content = para.content as Array<Record<string, unknown>>;

		expect(content[0]).toMatchObject({
			type: "text",
			text: "bold",
			styles: { bold: true },
		});
		expect(content[2]).toMatchObject({ type: "link", href: "https://x.dev" });
	});
});

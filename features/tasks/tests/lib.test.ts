import { describe, expect, it } from "bun:test";
import type { BlockJson } from "@/features/pages/schemas";
import { extractTaskBlocks } from "../lib/extract-task-blocks";
import { patchTaskBlock } from "../lib/patch-task-block";

function paragraph(id: string, children: BlockJson[] = []): BlockJson {
	return { id, type: "paragraph", props: {}, content: [], children };
}

function task(
	id: string,
	text: string,
	props: Record<string, unknown> = {},
	children: BlockJson[] = [],
): BlockJson {
	return {
		id,
		type: "task",
		props: { checked: false, due: "", ...props },
		content: [{ type: "text", text, styles: {} }],
		children,
	};
}

describe("extractTaskBlocks", () => {
	it("finds task blocks at any depth and reads their props", () => {
		const doc = [
			paragraph("p1", [
				task("t1", "Nested task", { checked: true, due: "2026-07-03" }),
			]),
			task("t2", "Top level"),
			paragraph("p2"),
		];

		expect(extractTaskBlocks(doc)).toEqual([
			{
				blockId: "t1",
				title: "Nested task",
				checked: true,
				due: "2026-07-03",
			},
			{ blockId: "t2", title: "Top level", checked: false, due: null },
		]);
	});

	it("concatenates styled and linked inline content into a plain title", () => {
		const doc: BlockJson[] = [
			{
				id: "t1",
				type: "task",
				props: { checked: false, due: "" },
				content: [
					{ type: "text", text: "Review ", styles: {} },
					{
						type: "link",
						href: "https://example.com",
						content: [{ type: "text", text: "the design doc", styles: {} }],
					},
					{ type: "text", text: " today", styles: { bold: true } },
				],
				children: [],
			},
		];

		expect(extractTaskBlocks(doc)[0]?.title).toBe(
			"Review the design doc today",
		);
	});

	it("keeps only the first occurrence of a duplicated block id", () => {
		const doc = [task("dup", "First"), task("dup", "Second")];

		const found = extractTaskBlocks(doc);
		expect(found).toHaveLength(1);
		expect(found[0]?.title).toBe("First");
	});
});

describe("patchTaskBlock", () => {
	it("patches a nested task block without mutating the original tree", () => {
		const doc = [paragraph("p1", [task("t1", "Nested")])];

		const { blocks, found } = patchTaskBlock(doc, "t1", {
			checked: true,
			due: "2026-07-04",
		});

		expect(found).toBe(true);
		expect(blocks[0]?.children[0]?.props).toEqual({
			checked: true,
			due: "2026-07-04",
		});
		expect(doc[0]?.children[0]?.props).toEqual({ checked: false, due: "" });
	});

	it("reports found=false when the block id is missing", () => {
		const { found } = patchTaskBlock([paragraph("p1")], "ghost", {
			checked: true,
		});
		expect(found).toBe(false);
	});

	it("maps a null due date to an empty prop", () => {
		const { blocks } = patchTaskBlock(
			[task("t1", "With due", { due: "2026-07-04" })],
			"t1",
			{ due: null },
		);
		expect(blocks[0]?.props.due).toBe("");
	});
});

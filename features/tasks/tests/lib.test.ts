import { describe, expect, it } from "bun:test";
import type { BlockJson } from "@/features/pages/schemas";
import { extractTaskBlocks } from "../lib/extract-task-blocks";
import { patchTaskBlock } from "../lib/patch-task-block";
import { reconcileTaskBlockProps } from "../lib/reconcile-task-block-props";

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
				assignee: null,
			},
			{
				blockId: "t2",
				title: "Top level",
				checked: false,
				due: null,
				assignee: null,
			},
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

describe("reconcileTaskBlockProps", () => {
	it("copies task-owned props from the authoritative document", () => {
		const current = [
			paragraph("p1", [
				task("t1", "Local text", {
					checked: false,
					due: "",
					assignee: "",
					color: "red",
				}),
			]),
			task("local", "New local task", { checked: true }),
		];
		const authoritative = [
			task("t1", "Server text", {
				checked: true,
				due: "2026-07-04",
				assignee: "user_teammate",
			}),
		];

		const { blocks, changed } = reconcileTaskBlockProps(current, authoritative);

		expect(changed).toBe(true);
		expect(blocks[0]?.children[0]?.content).toEqual(
			current[0]?.children[0]?.content,
		);
		expect(blocks[0]?.children[0]?.props).toEqual({
			checked: true,
			due: "2026-07-04",
			assignee: "user_teammate",
			color: "red",
		});
		expect(blocks[1]?.props.checked).toBe(true);
		expect(current[0]?.children[0]?.props.checked).toBe(false);
	});

	it("reports unchanged when task props already match", () => {
		const doc = [
			task("t1", "Done", {
				checked: true,
				due: "2026-07-04",
				assignee: "user_teammate",
			}),
		];

		const { blocks, changed } = reconcileTaskBlockProps(doc, doc);

		expect(changed).toBe(false);
		expect(blocks[0]).toBe(doc[0]);
	});

	it("treats missing optional task props as empty values", () => {
		const doc: BlockJson[] = [
			{
				id: "t1",
				type: "task",
				props: { checked: false, due: "" },
				content: [{ type: "text", text: "Legacy task", styles: {} }],
				children: [],
			},
		];

		const { changed } = reconcileTaskBlockProps(doc, doc);

		expect(changed).toBe(false);
	});
});

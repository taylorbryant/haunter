import { describe, expect, it } from "bun:test";
import type { BlockJson } from "@/features/pages/schemas";
import { extractTaskBlocks } from "../lib/extract-task-blocks";
import { patchTaskBlock } from "../lib/patch-task-block";
import { parseTaskDateShortcut, toIsoDate } from "../lib/parse-task-input";
import { reconcileTaskBlockProps } from "../lib/reconcile-task-block-props";
import { AUTO_TASK_ASSIGNEE } from "../lib/task-block-props";

function addDays(days: number): Date {
	const date = new Date();
	date.setDate(date.getDate() + days);
	return date;
}

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
				dueTime: null,
				assignee: null,
				useDefaultAssignee: false,
			},
			{
				blockId: "t2",
				title: "Top level",
				checked: false,
				due: null,
				dueTime: null,
				assignee: null,
				useDefaultAssignee: false,
			},
		]);
	});

	it("marks editor-created auto-assignee task blocks", () => {
		const doc = [task("t1", "Mine", { assignee: AUTO_TASK_ASSIGNEE })];

		expect(extractTaskBlocks(doc)[0]).toMatchObject({
			assignee: null,
			useDefaultAssignee: true,
		});
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

describe("parseTaskDateShortcut", () => {
	it("strips a natural-language date phrase from task inline content", () => {
		const result = parseTaskDateShortcut(
			[{ type: "text", text: "Eat a sandwich tomorrow", styles: {} }],
			"",
		);

		expect(result).toEqual({
			title: "Eat a sandwich",
			dueDate: toIsoDate(addDays(1)),
			dueTime: null,
		});
	});

	it("parses an ambiguous daytime time as PM", () => {
		const result = parseTaskDateShortcut(
			[
				{
					type: "text",
					text: "Pick up meds tomorrow at 2",
					styles: {},
				},
			],
			"",
		);

		expect(result).toEqual({
			title: "Pick up meds",
			dueDate: toIsoDate(addDays(1)),
			dueTime: "14:00",
		});
	});

	it("preserves explicit AM and 24-hour task times", () => {
		const explicitAm = parseTaskDateShortcut(
			[{ type: "text", text: "Take meds tomorrow at 2am", styles: {} }],
			"",
		);
		const twentyFourHour = parseTaskDateShortcut(
			[{ type: "text", text: "Call tomorrow at 14:30", styles: {} }],
			"",
		);

		expect(explicitAm?.dueTime).toBe("02:00");
		expect(twentyFourHour?.dueTime).toBe("14:30");
	});

	it("does not override an existing due date", () => {
		const result = parseTaskDateShortcut(
			[{ type: "text", text: "Eat a sandwich tomorrow", styles: {} }],
			"2026-07-10",
		);

		expect(result).toBeNull();
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
			dueTime: "",
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

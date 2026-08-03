import { describe, expect, it } from "bun:test";
import type { BlockJson } from "@/features/pages/schemas";
import type { TaskWithPage } from "@/features/tasks/schemas";
import { extractTaskBlocks } from "../lib/extract-task-blocks";
import {
	formatUpcomingDateHeading,
	groupTasksByDueDate,
} from "../lib/group-tasks-by-due-date";
import { parseTaskDateShortcut, toIsoDate } from "../lib/parse-task-input";
import { patchTaskBlock } from "../lib/patch-task-block";
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

function listedTask(id: string, dueDate: string | null): TaskWithPage {
	return {
		id,
		userId: "user-1",
		workspaceId: "workspace-1",
		pageId: null,
		sourceBlockId: null,
		title: id,
		completed: false,
		dueDate,
		dueTime: null,
		reminderOffsetMinutes: null,
		assigneeId: "user-1",
		assigneeName: "Taylor",
		pageTitle: null,
		completedAt: null,
		createdAt: "2026-07-01T00:00:00.000Z",
		updatedAt: "2026-07-01T00:00:00.000Z",
	};
}

describe("upcoming task groups", () => {
	it("groups due tasks without changing repository order", () => {
		const groups = groupTasksByDueDate([
			listedTask("first", "2026-07-10"),
			listedTask("second", "2026-07-10"),
			listedTask("third", "2026-07-12"),
			listedTask("undated", null),
		]);

		expect(
			groups.map((group) => ({
				date: group.date,
				ids: group.items.map((item) => item.id),
			})),
		).toEqual([
			{ date: "2026-07-10", ids: ["first", "second"] },
			{ date: "2026-07-12", ids: ["third"] },
		]);
	});

	it("formats future headings from the supplied local date", () => {
		expect(formatUpcomingDateHeading("2026-07-10", "2026-07-09")).toBe(
			"Tomorrow",
		);
		expect(formatUpcomingDateHeading("2026-07-13", "2026-07-09")).toBe(
			"Monday",
		);
		expect(formatUpcomingDateHeading("2026-07-16", "2026-07-09")).toBe(
			"Thu, Jul 16",
		);
	});
});

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
				reminderOffsetMinutes: null,
				assignee: null,
				useDefaultAssignee: false,
				rawAssignee: "",
			},
			{
				blockId: "t2",
				title: "Top level",
				checked: false,
				due: null,
				dueTime: null,
				reminderOffsetMinutes: null,
				assignee: null,
				useDefaultAssignee: false,
				rawAssignee: "",
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

	it("patches and clears a task reminder using the compatible string prop", () => {
		const doc = [
			task("t1", "Nested", {
				due: "2026-07-04",
				reminder: "",
			}),
		];
		const scheduled = patchTaskBlock(doc, "t1", {
			reminderOffsetMinutes: 60,
		});
		expect(scheduled.blocks[0]?.props.reminder).toBe("60");
		const cleared = patchTaskBlock(scheduled.blocks, "t1", {
			reminderOffsetMinutes: null,
		});
		expect(cleared.blocks[0]?.props.reminder).toBe("");
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
			reminder: "",
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

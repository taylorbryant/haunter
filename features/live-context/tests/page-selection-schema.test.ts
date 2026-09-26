import { expect, test } from "bun:test";
import { ActiveViewSchema, PageSelectionSchema } from "../schemas";
import { pageSelectionFixture } from "./helpers";

test("page selection is optional for old clients but requires a page and excludes canvas context", () => {
	const page = { pageId: crypto.randomUUID(), canvas: null };
	expect(ActiveViewSchema.parse(page)).toEqual(page);
	expect(
		ActiveViewSchema.safeParse({ ...page, pageSelection: pageSelectionFixture })
			.success,
	).toBe(true);
	const canvas = {
		canvasId: crypto.randomUUID(),
		canvasPageId: null,
		selectedShapeIds: [],
		selectionCount: 0,
	};
	expect(
		ActiveViewSchema.safeParse({
			...page,
			canvas,
			pageSelection: pageSelectionFixture,
		}).success,
	).toBe(false);
	expect(
		ActiveViewSchema.safeParse({
			pageId: null,
			canvas,
			pageSelection: pageSelectionFixture,
		}).success,
	).toBe(false);
});

test("page selections reject duplicate/unbounded IDs, text and inconsistent ranges/counts", () => {
	const text = pageSelectionFixture.selection!;
	for (const patch of [
		{ activeBlockId: "" },
		{ activeBlockId: "x".repeat(201) },
		{ selectedBlockIds: ["a", "a"] },
		{
			selectedBlockIds: Array.from({ length: 101 }, (_, i) => "b" + i),
			selectionCount: 101,
		},
		{ selectionCount: 1 },
		{ selection: { ...text, selectedText: "x".repeat(2001) } },
		{ selection: { ...text, head: -1 } },
		{ selection: { ...text, from: text.from + 1 } },
		{
			selection: {
				...text,
				head: text.anchor,
				to: text.anchor,
				selectedText: "",
			},
		},
	])
		expect(
			PageSelectionSchema.safeParse({ ...pageSelectionFixture, ...patch })
				.success,
		).toBe(false);
	expect(
		PageSelectionSchema.safeParse({
			...pageSelectionFixture,
			selectionCount: 0,
			selectedBlockIds: [],
			selection: {
				...text,
				head: text.anchor,
				to: text.anchor,
				selectedText: "",
			},
		}).success,
	).toBe(true);
});

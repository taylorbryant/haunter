import { expect, test } from "bun:test";
import {
	CanvasTextSelectionSchema,
	LIVE_CONTEXT_MAX_SELECTED_TEXT,
} from "../schemas";
import { textEditingFixture } from "./helpers";

test("validates bounded, internally consistent text ranges and carets", () => {
	const selection = textEditingFixture.selection!;
	expect(CanvasTextSelectionSchema.safeParse(selection).success).toBe(true);
	for (const patch of [
		{ anchor: -1 },
		{ head: 1.5 },
		{ head: Number.MAX_SAFE_INTEGER + 1 },
		{ from: 9, to: 1 },
		{ from: 2 },
		{ kind: "node" },
		{ coordinateSystem: "utf16" },
		{ selectedText: "a".repeat(LIVE_CONTEXT_MAX_SELECTED_TEXT + 1) },
		{ anchor: 1, head: 1, from: 1, to: 1 },
		{ anchor: 1, head: 1, from: 1, to: 1, selectedText: "", truncated: true },
	]) {
		expect(
			CanvasTextSelectionSchema.safeParse({ ...selection, ...patch }).success,
		).toBe(false);
	}
	expect(
		CanvasTextSelectionSchema.safeParse({
			...selection,
			anchor: 1,
			head: 1,
			from: 1,
			to: 1,
			selectedText: "",
		}).success,
	).toBe(true);
});

import { describe, expect, test } from "bun:test";
import {
	editCodeBlockIndentation,
	getCodeBlockIndentPositions,
	getCodeBlockUnindentRanges,
} from "../components/editor/code-block-indent";

function applyIndent(text: string, from: number, to: number): string {
	const positions = getCodeBlockIndentPositions(text, from, to);
	let result = text;
	for (const position of positions.reverse()) {
		result = `${result.slice(0, position)}  ${result.slice(position)}`;
	}
	return result;
}

function applyUnindent(text: string, from: number, to = from): string {
	const ranges = getCodeBlockUnindentRanges(text, from, to);
	let result = text;
	for (const range of ranges.reverse()) {
		result = result.slice(0, range.from) + result.slice(range.to);
	}
	return result;
}

describe("code block unindent", () => {
	test("removes one two-space indentation level from the current line", () => {
		expect(applyUnindent("first\n    second", 12)).toBe("first\n  second");
	});

	test("removes a leading tab or a partial space indentation", () => {
		expect(applyUnindent("\tvalue", 3)).toBe("value");
		expect(applyUnindent(" value", 3)).toBe("value");
	});

	test("unindents every line touched by a selection", () => {
		expect(applyUnindent("  one\n    two\n  three", 2, 21)).toBe(
			"one\n  two\nthree",
		);
	});

	test("does not include a line when the selection ends at its start", () => {
		expect(applyUnindent("  one\n  two", 0, 6)).toBe("one\n  two");
	});

	test("leaves an unindented line unchanged", () => {
		expect(applyUnindent("value", 3)).toBe("value");
	});

	test("keeps a cursor at the start of an empty first line", () => {
		expect(applyUnindent("\n  value", 0)).toBe("\n  value");
	});
});

describe("code block indent", () => {
	test("indents the full line containing a partial selection", () => {
		expect(applyIndent("const value = 1;", 6, 11)).toBe("  const value = 1;");
	});

	test("indents every line touched by a selection", () => {
		expect(applyIndent("one\ntwo\nthree", 1, 11)).toBe("  one\n  two\n  three");
	});

	test("does not include a line when the selection ends at its start", () => {
		expect(applyIndent("one\ntwo", 0, 4)).toBe("  one\ntwo");
	});
});

describe("fullscreen code block indentation", () => {
	test("indents at the current line and keeps the cursor with its text", () => {
		expect(editCodeBlockIndentation("one\ntwo", 6, 6, false)).toEqual({
			text: "one\n  two",
			selectionFrom: 8,
			selectionTo: 8,
		});
	});

	test("indents a multiline selection without selecting the inserted spaces", () => {
		expect(editCodeBlockIndentation("one\ntwo\nthree", 0, 7, false)).toEqual({
			text: "  one\n  two\nthree",
			selectionFrom: 2,
			selectionTo: 11,
		});
	});

	test("unindents selected lines and preserves the logical selection", () => {
		expect(
			editCodeBlockIndentation("  one\n\ttwo\nthree", 2, 11, true),
		).toEqual({
			text: "one\ntwo\nthree",
			selectionFrom: 0,
			selectionTo: 8,
		});
	});

	test("keeps focus in place when Shift-Tab has nothing to remove", () => {
		expect(editCodeBlockIndentation("one", 2, 2, true)).toEqual({
			text: "one",
			selectionFrom: 2,
			selectionTo: 2,
		});
	});
});

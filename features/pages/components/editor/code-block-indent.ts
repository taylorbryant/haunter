export type CodeBlockUnindentRange = {
	from: number;
	to: number;
};

const CODE_BLOCK_INDENT_SIZE = 2;

function getIndentWidth(text: string, lineStart: number): number {
	if (text[lineStart] === "\t") return 1;

	let width = 0;
	while (
		width < CODE_BLOCK_INDENT_SIZE &&
		text[lineStart + width] === " "
	) {
		width += 1;
	}
	return width;
}

/** Returns indentation ranges to remove, relative to the code block's text. */
export function getCodeBlockUnindentRanges(
	text: string,
	selectionFrom: number,
	selectionTo: number,
): CodeBlockUnindentRange[] {
	const from = Math.max(0, Math.min(selectionFrom, text.length));
	const to = Math.max(from, Math.min(selectionTo, text.length));
	const firstLineStart = text.lastIndexOf("\n", from - 1) + 1;
	// A selection ending exactly at a new line should not modify that line.
	const effectiveEnd = to > from && text[to - 1] === "\n" ? to - 1 : to;
	const ranges: CodeBlockUnindentRange[] = [];

	let lineStart = firstLineStart;
	while (lineStart <= effectiveEnd) {
		const width = getIndentWidth(text, lineStart);
		if (width > 0) {
			ranges.push({ from: lineStart, to: lineStart + width });
		}

		const nextLineBreak = text.indexOf("\n", lineStart);
		if (nextLineBreak === -1 || nextLineBreak >= effectiveEnd) break;
		lineStart = nextLineBreak + 1;
	}

	return ranges;
}

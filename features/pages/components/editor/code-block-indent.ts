export type CodeBlockUnindentRange = {
	from: number;
	to: number;
};

export type CodeBlockIndentEdit = {
	text: string;
	selectionFrom: number;
	selectionTo: number;
};

const CODE_BLOCK_INDENT_SIZE = 2;

function getSelectedLineStarts(
	text: string,
	selectionFrom: number,
	selectionTo: number,
): number[] {
	const from = Math.max(0, Math.min(selectionFrom, text.length));
	const to = Math.max(from, Math.min(selectionTo, text.length));
	const firstLineStart = text.lastIndexOf("\n", from - 1) + 1;
	// A selection ending exactly at a new line should not modify that line.
	const effectiveEnd = to > from && text[to - 1] === "\n" ? to - 1 : to;
	const lineStarts: number[] = [];

	let lineStart = firstLineStart;
	while (lineStart <= effectiveEnd) {
		lineStarts.push(lineStart);
		const nextLineBreak = text.indexOf("\n", lineStart);
		if (nextLineBreak === -1 || nextLineBreak >= effectiveEnd) break;
		lineStart = nextLineBreak + 1;
	}

	return lineStarts;
}

function getIndentWidth(text: string, lineStart: number): number {
	if (text[lineStart] === "\t") return 1;

	let width = 0;
	while (width < CODE_BLOCK_INDENT_SIZE && text[lineStart + width] === " ") {
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
	const ranges: CodeBlockUnindentRange[] = [];
	for (const lineStart of getSelectedLineStarts(
		text,
		selectionFrom,
		selectionTo,
	)) {
		const width = getIndentWidth(text, lineStart);
		if (width > 0) {
			ranges.push({ from: lineStart, to: lineStart + width });
		}
	}

	return ranges;
}

/** Returns line-start positions to indent, relative to the code block's text. */
export function getCodeBlockIndentPositions(
	text: string,
	selectionFrom: number,
	selectionTo: number,
): number[] {
	return getSelectedLineStarts(text, selectionFrom, selectionTo);
}

function removedCharactersBefore(
	position: number,
	ranges: CodeBlockUnindentRange[],
): number {
	return ranges.reduce((total, range) => {
		if (position <= range.from) return total;
		return total + Math.min(position, range.to) - range.from;
	}, 0);
}

/** Applies the same Tab indentation semantics to a plain-text editing surface. */
export function editCodeBlockIndentation(
	text: string,
	selectionFrom: number,
	selectionTo: number,
	unindent: boolean,
): CodeBlockIndentEdit {
	if (unindent) {
		const ranges = getCodeBlockUnindentRanges(text, selectionFrom, selectionTo);
		let nextText = text;
		for (const range of ranges.reverse()) {
			nextText = nextText.slice(0, range.from) + nextText.slice(range.to);
		}

		return {
			text: nextText,
			selectionFrom:
				selectionFrom - removedCharactersBefore(selectionFrom, ranges),
			selectionTo: selectionTo - removedCharactersBefore(selectionTo, ranges),
		};
	}

	const positions = getCodeBlockIndentPositions(
		text,
		selectionFrom,
		selectionTo,
	);
	let nextText = text;
	for (const position of positions.reverse()) {
		nextText = `${nextText.slice(0, position)}${" ".repeat(CODE_BLOCK_INDENT_SIZE)}${nextText.slice(position)}`;
	}
	const insertedBefore = (position: number) =>
		positions.filter((lineStart) => lineStart <= position).length *
		CODE_BLOCK_INDENT_SIZE;

	return {
		text: nextText,
		selectionFrom: selectionFrom + insertedBefore(selectionFrom),
		selectionTo: selectionTo + insertedBefore(selectionTo),
	};
}

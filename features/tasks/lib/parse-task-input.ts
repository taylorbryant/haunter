import * as chrono from "chrono-node";
import {
	formatDueDateTimeLabel,
	toIsoDate as toIsoDateValue,
} from "@/lib/due-date";

export type ParsedTaskInput = {
	/** Title with the date phrase stripped (and dangling prepositions tidied). */
	title: string;
	/** Local YYYY-MM-DD from the date phrase, if one was found. */
	dueDate: string | null;
	/** Local HH:mm when the phrase includes a time. */
	dueTime: string | null;
	/** Where the date phrase sits in the raw text, for inline highlighting. */
	match: { index: number; text: string } | null;
};

export type ParsedTaskDateShortcut = {
	title: string;
	dueDate: string;
	dueTime: string | null;
};

type InlineNode = {
	text?: string;
	content?: unknown;
};

export function toIsoDate(date: Date): string {
	return toIsoDateValue(date);
}

/**
 * Todoist-style natural language parsing: "buy groceries tomorrow" →
 * title "buy groceries", due tomorrow. The last date mention wins.
 */
function parsedDueTime(result: chrono.ParsedResult): string | null {
	if (!result.start.isCertain("hour")) return null;

	let hour = result.start.get("hour") ?? 0;
	const minute = result.start.get("minute") ?? 0;

	// In a 12-hour locale, phrases like "at 2" are normally daytime tasks.
	// Chrono defaults them to AM, so use a predictable working-day heuristic;
	// explicit am/pm and 24-hour times always keep Chrono's value.
	if (!result.start.isCertain("meridiem") && hour >= 1 && hour <= 6) {
		hour += 12;
	}

	return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function parseTaskInput(
	text: string,
	referenceDate = new Date(),
): ParsedTaskInput {
	const results = chrono.parse(text, referenceDate, { forwardDate: true });
	const match = results[results.length - 1];
	if (!match) {
		return { title: text.trim(), dueDate: null, dueTime: null, match: null };
	}

	const title = (
		text.slice(0, match.index) + text.slice(match.index + match.text.length)
	)
		.replace(/\s{2,}/g, " ")
		.trim()
		// Drop a now-dangling preposition ("pay rent by friday" → "pay rent").
		.replace(/\s+(?:on|at|by|due|until|before)$/i, "")
		.trim();

	// If the whole input was a date phrase, treat it as a plain title.
	if (!title) {
		return { title: text.trim(), dueDate: null, dueTime: null, match: null };
	}

	return {
		title,
		dueDate: toIsoDate(match.start.date()),
		dueTime: parsedDueTime(match),
		match: { index: match.index, text: match.text },
	};
}

/** Concatenate BlockNote-ish inline content into the text the user sees. */
export function taskInlineText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	let text = "";
	for (const node of content as InlineNode[]) {
		if (typeof node?.text === "string") {
			text += node.text;
		} else if (node?.content) {
			text += taskInlineText(node.content);
		}
	}
	return text;
}

export function parseTaskDateShortcut(
	content: unknown,
	dueDate: string | null | undefined,
): ParsedTaskDateShortcut | null {
	if (dueDate) return null;

	const parsed = parseTaskInput(taskInlineText(content));
	if (!parsed.match || !parsed.dueDate) return null;

	return {
		title: parsed.title,
		dueDate: parsed.dueDate,
		dueTime: parsed.dueTime,
	};
}

/** "Today", "Tomorrow, 2:00 PM", a weekday within a week, else "Jul 16". */
export function humanizeDueDate(
	iso: string,
	time: string | null = null,
): string {
	return formatDueDateTimeLabel(iso, time);
}

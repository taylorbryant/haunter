import * as chrono from "chrono-node";

export type ParsedTaskInput = {
	/** Title with the date phrase stripped (and dangling prepositions tidied). */
	title: string;
	/** Local YYYY-MM-DD from the date phrase, if one was found. */
	dueDate: string | null;
	/** Where the date phrase sits in the raw text, for inline highlighting. */
	match: { index: number; text: string } | null;
};

export type ParsedTaskDateShortcut = {
	title: string;
	dueDate: string;
};

type InlineNode = {
	text?: string;
	content?: unknown;
};

export function toIsoDate(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Todoist-style natural language parsing: "buy groceries tomorrow" →
 * title "buy groceries", due tomorrow. The last date mention wins.
 */
export function parseTaskInput(text: string): ParsedTaskInput {
	const results = chrono.parse(text, new Date(), { forwardDate: true });
	const match = results[results.length - 1];
	if (!match) return { title: text.trim(), dueDate: null, match: null };

	const title = (
		text.slice(0, match.index) + text.slice(match.index + match.text.length)
	)
		.replace(/\s{2,}/g, " ")
		.trim()
		// Drop a now-dangling preposition ("pay rent by friday" → "pay rent").
		.replace(/\s+(?:on|at|by|due|until|before)$/i, "")
		.trim();

	// If the whole input was a date phrase, treat it as a plain title.
	if (!title) return { title: text.trim(), dueDate: null, match: null };

	return {
		title,
		dueDate: toIsoDate(match.start.date()),
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

	return { title: parsed.title, dueDate: parsed.dueDate };
}

/** "Today", "Tomorrow", a weekday within a week, else "Jul 16". */
export function humanizeDueDate(iso: string): string {
	const [year, month, day] = iso.split("-").map(Number);
	if (!year || !month || !day) return iso;
	const date = new Date(year, month - 1, day);
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);

	if (days === 0) return "Today";
	if (days === 1) return "Tomorrow";
	if (days > 1 && days < 7) {
		return date.toLocaleDateString(undefined, { weekday: "long" });
	}
	return date.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
	});
}
